package ai.tigeriq.worker;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private EmployeeProfileStore profileStore;
    private TextView statusView;
    private EditText employeeId;
    private EditText department;
    private EditText role;
    private EditText provider;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WorkerIdentity.ensureDeviceKey();
        profileStore = new EmployeeProfileStore(this);
        setContentView(buildScreen());

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        }
        startWorkerService();
        refreshStatus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (statusView != null) refreshStatus();
    }

    private View buildScreen() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(24), dp(20), dp(32));
        scroll.addView(root);

        TextView title = text("TigerIQ Worker · Pilot Employee", 22, true);
        root.addView(title);
        TextView subtitle = text("Z Flip 7 thử nghiệm · 1 máy = 1 nhân viên cố định", 14, false);
        subtitle.setPadding(0, dp(4), 0, dp(20));
        root.addView(subtitle);

        EmployeeProfileStore.Profile profile = profileStore.load();
        employeeId = field("Mã nhân viên", profile.employeeId);
        department = field("Phòng ban", profile.department);
        role = field("Vai trò", profile.role);
        provider = field("AI chính", profile.provider);
        root.addView(employeeId);
        root.addView(department);
        root.addView(role);
        root.addView(provider);

        Button save = button("Lưu nhân viên");
        save.setOnClickListener(v -> {
            profileStore.save(employeeId.getText().toString(), department.getText().toString(), role.getText().toString(), provider.getText().toString());
            Toast.makeText(this, "Đã lưu hồ sơ nhân viên", Toast.LENGTH_SHORT).show();
            refreshStatus();
        });
        root.addView(save);

        Button accessibility = button("Bật quyền điều khiển hỗ trợ (Accessibility)");
        accessibility.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        root.addView(accessibility);

        Button gemini = button("Mở Gemini");
        gemini.setOnClickListener(v -> openGemini());
        root.addView(gemini);

        Button refresh = button("Kiểm tra trạng thái");
        refresh.setOnClickListener(v -> refreshStatus());
        root.addView(refresh);

        statusView = text("", 14, false);
        statusView.setPadding(0, dp(18), 0, 0);
        root.addView(statusView);

        TextView note = text(
            "Pilot hiện tại xác minh danh tính thiết bị, hồ sơ nhân viên, Worker runtime, Keystore, Accessibility và khả năng mở Gemini. Tự động gửi prompt/đọc kết quả Gemini chỉ được bật sau khi adapter Gemini trên thiết bị thật PASS gate riêng.",
            12,
            false
        );
        note.setPadding(0, dp(18), 0, 0);
        root.addView(note);
        return scroll;
    }

    private void refreshStatus() {
        EmployeeProfileStore.Profile profile = profileStore.load();
        boolean accessibility = accessibilityEnabled();
        String lastPackage = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE)
            .getString(AccessibilityBridgeService.KEY_LAST_PACKAGE, "chưa có");
        boolean paired = false;
        try {
            paired = new SecureCredentialStore(this).load() != null;
        } catch (Exception ignored) {
            paired = false;
        }
        statusView.setText(
            "TRẠNG THÁI\n" +
            "• Employee: " + profile.employeeId + " · " + profile.department + " / " + profile.role + "\n" +
            "• AI chính: " + profile.provider + "\n" +
            "• Device identity: READY\n" +
            "• Worker runtime: ACTIVE\n" +
            "• Accessibility: " + (accessibility ? "ON" : "OFF") + "\n" +
            "• Controller pairing: " + (paired ? "PAIRED" : "CHƯA GHÉP") + "\n" +
            "• App nhìn thấy gần nhất: " + lastPackage
        );
    }

    private boolean accessibilityEnabled() {
        ComponentName component = new ComponentName(this, AccessibilityBridgeService.class);
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return enabled != null && enabled.contains(component.flattenToString());
    }

    private void openGemini() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.google.android.apps.bard");
        if (launch == null) launch = getPackageManager().getLaunchIntentForPackage("com.google.android.googlequicksearchbox");
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(launch);
            return;
        }
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://gemini.google.com/app")));
    }

    private void startWorkerService() {
        Intent intent = new Intent(this, ForegroundWorkerService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
        else startService(intent);
    }

    private EditText field(String hint, String value) {
        EditText edit = new EditText(this);
        edit.setHint(hint);
        edit.setText(value);
        edit.setSingleLine(true);
        edit.setInputType(InputType.TYPE_CLASS_TEXT);
        edit.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(8));
        edit.setLayoutParams(params);
        return edit;
    }

    private Button button(String label) {
        Button button = new Button(this);
        button.setText(label);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, dp(5), 0, dp(5));
        button.setLayoutParams(params);
        return button;
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        if (bold) view.setTypeface(view.getTypeface(), android.graphics.Typeface.BOLD);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
