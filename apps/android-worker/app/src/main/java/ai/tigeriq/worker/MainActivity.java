package ai.tigeriq.worker;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
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

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final String DEFAULT_CONTROLLER = "http://100.97.23.87:8790";

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private EmployeeProfileStore profileStore;
    private TextView statusView;
    private EditText employeeId;
    private EditText department;
    private EditText role;
    private EditText provider;
    private EditText controllerUrl;

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

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        super.onDestroy();
    }

    private View buildScreen() {
        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(20), dp(24), dp(20), dp(32));
        scroll.addView(root);

        root.addView(text("TigerIQ Worker · Employee Node", 22, true));
        TextView subtitle = text("Z Flip 7 thử nghiệm · 1 máy = 1 nhân viên cố định", 14, false);
        subtitle.setPadding(0, dp(4), 0, dp(20));
        root.addView(subtitle);

        EmployeeProfileStore.Profile profile = profileStore.load();
        employeeId = field("Mã nhân viên", profile.employeeId, false);
        department = field("Phòng ban", profile.department, false);
        role = field("Vai trò", profile.role, false);
        provider = field("AI chính", profile.provider, false);
        controllerUrl = field("Controller", currentControllerUrl(), true);
        root.addView(employeeId);
        root.addView(department);
        root.addView(role);
        root.addView(provider);
        root.addView(controllerUrl);

        Button save = button("Lưu nhân viên");
        save.setOnClickListener(v -> {
            saveProfile();
            Toast.makeText(this, "Đã lưu hồ sơ nhân viên", Toast.LENGTH_SHORT).show();
            refreshStatus();
        });
        root.addView(save);

        Button tailscale = button("Mở Tailscale");
        tailscale.setOnClickListener(v -> openTailscale());
        root.addView(tailscale);

        Button pair = button("Ghép Controller");
        pair.setOnClickListener(v -> pairController(pair));
        root.addView(pair);

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
            "Gate hiện tại: ghép thiết bị thật với TigerIQ Controller và heartbeat ONLINE. Tự động nhập prompt/đọc kết quả Gemini chưa bật ở gate này.",
            12,
            false
        );
        note.setPadding(0, dp(18), 0, 0);
        root.addView(note);
        return scroll;
    }

    private void saveProfile() {
        profileStore.save(
            employeeId.getText().toString(),
            department.getText().toString(),
            role.getText().toString(),
            provider.getText().toString()
        );
    }

    private void pairController(Button button) {
        saveProfile();
        final String targetInput = controllerUrl.getText().toString();
        button.setEnabled(false);
        Toast.makeText(this, "Đang ghép Controller…", Toast.LENGTH_SHORT).show();
        networkExecutor.execute(() -> {
            try {
                String target = ControllerUrlPolicy.requireTrusted(targetInput);
                SecureCredentialStore secureStore = new SecureCredentialStore(this);
                ControllerClient client = new ControllerClient(secureStore);
                String nodeId = new NodeIdentityStore(this).getOrCreate();
                EmployeeProfileStore.Profile profile = profileStore.load();

                if (secureStore.load() == null) {
                    JSONObject challengeResponse = client.requestPairingChallenge(target);
                    JSONObject pairing = challengeResponse.getJSONObject("pairing");
                    client.pair(
                        target,
                        pairing.getString("challengeId"),
                        pairing.getString("challenge"),
                        nodeId,
                        Build.MANUFACTURER + " " + Build.MODEL + " / Android " + Build.VERSION.RELEASE,
                        WorkerVersion.NAME,
                        new String[]{"android-ui", "research", "gemini"}
                    );
                }

                client.registerEmployee(
                    profile.employeeId,
                    profile.employeeId + " · " + profile.role,
                    profile.department,
                    profile.role,
                    profile.provider,
                    new String[]{"research", "gemini"}
                );
                client.heartbeat(batteryPct(), null, WorkerVersion.NAME);
                writeControllerStatus("ONLINE", System.currentTimeMillis(), "");
                runOnUiThread(() -> {
                    Toast.makeText(this, "Ghép thành công · " + profile.employeeId + " ONLINE", Toast.LENGTH_LONG).show();
                    button.setEnabled(true);
                    refreshStatus();
                });
            } catch (Exception error) {
                String raw = error.getMessage();
                final String message = raw == null || raw.trim().isEmpty() ? error.getClass().getSimpleName() : raw;
                writeControllerStatus("OFFLINE", 0L, message.length() > 160 ? message.substring(0, 160) : message);
                runOnUiThread(() -> {
                    Toast.makeText(this, friendlyPairingError(message), Toast.LENGTH_LONG).show();
                    button.setEnabled(true);
                    refreshStatus();
                });
            }
        });
    }

    private void writeControllerStatus(String state, long heartbeatAt, String error) {
        getSharedPreferences(ForegroundWorkerService.PREFS, Context.MODE_PRIVATE).edit()
            .putString(ForegroundWorkerService.KEY_CONTROLLER_STATE, state)
            .putLong(ForegroundWorkerService.KEY_LAST_HEARTBEAT_AT, heartbeatAt)
            .putString(ForegroundWorkerService.KEY_LAST_ERROR, error)
            .apply();
    }

    private String friendlyPairingError(String message) {
        String lower = message.toLowerCase();
        if (lower.contains("failed to connect") || lower.contains("connect") || lower.contains("timeout") || lower.contains("unreachable")) {
            return "Chưa thấy PC01 Controller · mở Tailscale rồi bấm Ghép lại";
        }
        if (lower.contains("tailnet")) return "Thiết bị chưa được Controller nhận là peer Tailscale";
        return "Ghép thất bại: " + (message.length() > 90 ? message.substring(0, 90) : message);
    }

    private void refreshStatus() {
        EmployeeProfileStore.Profile profile = profileStore.load();
        boolean accessibility = accessibilityEnabled();
        String lastPackage = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE)
            .getString(AccessibilityBridgeService.KEY_LAST_PACKAGE, "chưa có");
        String controllerState = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE)
            .getString(ForegroundWorkerService.KEY_CONTROLLER_STATE, "UNPAIRED");
        long lastHeartbeat = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE)
            .getLong(ForegroundWorkerService.KEY_LAST_HEARTBEAT_AT, 0L);
        String lastError = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE)
            .getString(ForegroundWorkerService.KEY_LAST_ERROR, "");
        boolean paired;
        try {
            paired = new SecureCredentialStore(this).load() != null;
        } catch (Exception ignored) {
            paired = false;
        }
        String nodeId = new NodeIdentityStore(this).getOrCreate();
        String heartbeatText = lastHeartbeat > 0 ? ((System.currentTimeMillis() - lastHeartbeat) / 1000L) + " giây trước" : "chưa có";
        StringBuilder status = new StringBuilder()
            .append("TRẠNG THÁI\n")
            .append("• Employee: ").append(profile.employeeId).append(" · ").append(profile.department).append(" / ").append(profile.role).append("\n")
            .append("• Node: ").append(nodeId).append("\n")
            .append("• AI chính: ").append(profile.provider).append("\n")
            .append("• Device identity: READY\n")
            .append("• Worker runtime: ACTIVE\n")
            .append("• Accessibility: ").append(accessibility ? "ON" : "OFF").append("\n")
            .append("• Controller pairing: ").append(paired ? "PAIRED" : "CHƯA GHÉP").append("\n")
            .append("• Controller: ").append(controllerState).append("\n")
            .append("• Heartbeat: ").append(heartbeatText).append("\n")
            .append("• App nhìn thấy gần nhất: ").append(lastPackage);
        if (lastError != null && !lastError.isEmpty()) status.append("\n• Lỗi gần nhất: ").append(lastError);
        statusView.setText(status.toString());
    }

    private String currentControllerUrl() {
        try {
            SecureCredentialStore.Credential credential = new SecureCredentialStore(this).load();
            if (credential != null) return credential.controllerUrl;
        } catch (Exception ignored) {
        }
        return DEFAULT_CONTROLLER;
    }

    private boolean accessibilityEnabled() {
        ComponentName component = new ComponentName(this, AccessibilityBridgeService.class);
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        return enabled != null && enabled.contains(component.flattenToString());
    }

    private int batteryPct() {
        android.os.BatteryManager manager = (android.os.BatteryManager) getSystemService(Context.BATTERY_SERVICE);
        if (manager == null) return 0;
        int value = manager.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY);
        return Math.max(0, Math.min(100, value));
    }

    private void openTailscale() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn");
        if (launch != null) {
            startActivity(launch);
            return;
        }
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.tailscale.ipn")));
        } catch (Exception ignored) {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.tailscale.ipn")));
        }
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

    private EditText field(String hint, String value, boolean uri) {
        EditText edit = new EditText(this);
        edit.setHint(hint);
        edit.setText(value);
        edit.setSingleLine(true);
        edit.setInputType(uri ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI : InputType.TYPE_CLASS_TEXT);
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
