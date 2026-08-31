package ai.tigeriq.worker;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
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

/** Dedicated onboarding and status surface for one TigerIQ Android employee. */
public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final String DEFAULT_CONTROLLER = "http://100.97.23.87:8790";
    private static final int INK = Color.rgb(20, 30, 45);
    private static final int MUTED = Color.rgb(93, 108, 128);
    private static final int ORANGE = Color.rgb(242, 121, 40);
    private static final int GOLD = Color.rgb(255, 190, 67);
    private static final int GREEN = Color.rgb(20, 137, 97);
    private static final int RED = Color.rgb(189, 57, 57);

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private EmployeeProfileStore profileStore;
    private TextView readinessView;
    private TextView accessState;
    private TextView tailscaleState;
    private TextView controllerState;
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
        requestNotificationPermissionIfNeeded();
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
        scroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(20), dp(18), dp(30));
        root.setBackgroundColor(Color.rgb(248, 249, 252));
        scroll.addView(root);

        root.addView(brandHeader());
        readinessView = text("", 15, true);
        readinessView.setPadding(dp(16), dp(14), dp(16), dp(14));
        root.addView(readinessView, marginParams(0, dp(14), 0, dp(14)));

        root.addView(sectionTitle("Thiết lập nhân viên"));
        root.addView(text("Mỗi điện thoại là một nhân viên TigerIQ. Điền một lần, ứng dụng sẽ lưu trên thiết bị.", 13, false));

        LinearLayout profileCard = card();
        EmployeeProfileStore.Profile profile = profileStore.load();
        employeeId = field("Mã nhân viên", profile.employeeId, false);
        department = field("Phòng ban", profile.department, false);
        role = field("Vai trò", profile.role, false);
        provider = field("AI làm việc", profile.provider, false);
        profileCard.addView(employeeId);
        profileCard.addView(department);
        profileCard.addView(role);
        profileCard.addView(provider);
        Button save = primaryButton("Lưu hồ sơ nhân viên");
        save.setOnClickListener(v -> {
            saveProfile();
            Toast.makeText(this, "Đã lưu hồ sơ nhân viên", Toast.LENGTH_SHORT).show();
            refreshStatus();
        });
        profileCard.addView(save, marginParams(0, dp(8), 0, 0));
        root.addView(profileCard, marginParams(0, dp(8), 0, dp(18)));

        root.addView(sectionTitle("Kết nối theo từng bước"));
        root.addView(text("Làm theo thứ tự. Mỗi bước sẽ tự hiện trạng thái ngay khi quay lại ứng dụng.", 13, false));

        LinearLayout setupCard = card();
        accessState = step(setupCard, "1", "Cho phép thông báo & Worker chạy nền", "Đang kiểm tra…", "Mở cài đặt quyền", v -> requestNotificationPermissionIfNeeded());
        tailscaleState = step(setupCard, "2", "Kết nối mạng riêng Tailscale", "Cần mở Tailscale và đăng nhập", "Mở Tailscale", v -> openTailscale());
        controllerState = step(setupCard, "3", "Ghép với Controller", "Chờ PC01 Controller hoạt động", "Ghép Controller", v -> pairController((Button) v));
        root.addView(setupCard, marginParams(0, dp(8), 0, dp(12)));

        Button guide = secondaryButton("Xem hướng dẫn kết nối");
        guide.setOnClickListener(v -> showConnectionGuide());
        root.addView(guide, marginParams(0, 0, 0, dp(18)));

        root.addView(sectionTitle("Công cụ nhân viên"));
        LinearLayout tools = card();
        Button accessibility = secondaryButton("Bật quyền điều khiển hỗ trợ");
        accessibility.setOnClickListener(v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        tools.addView(accessibility);
        Button gemini = secondaryButton("Mở Gemini");
        gemini.setOnClickListener(v -> openGemini());
        tools.addView(gemini, marginParams(0, dp(8), 0, 0));
        root.addView(tools, marginParams(0, dp(8), 0, dp(18)));

        root.addView(sectionTitle("Trạng thái thiết bị"));
        LinearLayout statusCard = card();
        statusView = text("", 14, false);
        statusCard.addView(statusView);
        Button refresh = secondaryButton("Làm mới trạng thái");
        refresh.setOnClickListener(v -> refreshStatus());
        statusCard.addView(refresh, marginParams(0, dp(12), 0, 0));
        root.addView(statusCard, marginParams(0, dp(8), 0, dp(12)));

        TextView boundary = text("Gemini chỉ được mở thủ công ở giai đoạn này. Tự gửi prompt và lấy kết quả chỉ bật sau khi Controller, pairing và policy đều PASS.", 12, false);
        boundary.setTextColor(MUTED);
        root.addView(boundary);
        return scroll;
    }

    private View brandHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(18), dp(18), dp(18), dp(18));
        header.setBackground(roundRect(INK, 20));

        TextView mark = text("TI", 20, true);
        mark.setTextColor(INK);
        mark.setGravity(Gravity.CENTER);
        mark.setBackground(roundRect(GOLD, 24));
        header.addView(mark, fixedParams(dp(48), dp(48), 0, 0, dp(14), 0));

        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        TextView name = text("TigerIQ AI", 22, true);
        name.setTextColor(Color.WHITE);
        words.addView(name);
        TextView label = text("WORKER · NHÂN SỰ SỐ", 11, true);
        label.setTextColor(GOLD);
        words.addView(label, marginParams(0, dp(2), 0, 0));
        header.addView(words, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        return header;
    }

    private TextView step(LinearLayout parent, String number, String title, String state, String action, View.OnClickListener listener) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        TextView numberView = text(number, 15, true);
        numberView.setTextColor(Color.WHITE);
        numberView.setGravity(Gravity.CENTER);
        numberView.setBackground(roundRect(ORANGE, 16));
        row.addView(numberView, fixedParams(dp(32), dp(32), 0, 0, dp(10), 0));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView titleView = text(title, 14, true);
        titleView.setTextColor(INK);
        copy.addView(titleView);
        TextView stateView = text(state, 12, false);
        stateView.setTextColor(MUTED);
        copy.addView(stateView, marginParams(0, dp(2), 0, 0));
        row.addView(copy, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        Button button = secondaryButton(action);
        button.setTextSize(11);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(10), dp(8), dp(10), dp(8));
        button.setOnClickListener(listener);
        row.addView(button);
        parent.addView(row, marginParams(0, 0, 0, dp(14)));
        return stateView;
    }

    private void saveProfile() {
        profileStore.save(employeeId.getText().toString(), department.getText().toString(), role.getText().toString(), provider.getText().toString());
    }

    private void pairController(Button button) {
        saveProfile();
        final String targetInput = controllerUrl == null ? currentControllerUrl() : controllerUrl.getText().toString();
        button.setEnabled(false);
        button.setText("Đang ghép…");
        networkExecutor.execute(() -> {
            try {
                String target = ControllerUrlPolicy.requireTrusted(targetInput);
                SecureCredentialStore secureStore = new SecureCredentialStore(this);
                ControllerClient client = new ControllerClient(secureStore);
                String nodeId = new NodeIdentityStore(this).getOrCreate();
                EmployeeProfileStore.Profile profile = profileStore.load();
                if (secureStore.load() == null) {
                    JSONObject pairing = client.requestPairingChallenge(target).getJSONObject("pairing");
                    client.pair(target, pairing.getString("challengeId"), pairing.getString("challenge"), nodeId,
                        Build.MANUFACTURER + " " + Build.MODEL + " / Android " + Build.VERSION.RELEASE,
                        WorkerVersion.NAME, new String[]{"android-ui", "research", "gemini"});
                }
                client.registerEmployee(profile.employeeId, profile.employeeId + " · " + profile.role, profile.department, profile.role, profile.provider, new String[]{"research", "gemini"});
                client.heartbeat(batteryPct(), null, WorkerVersion.NAME);
                writeControllerStatus("ONLINE", System.currentTimeMillis(), "");
                runOnUiThread(() -> {
                    Toast.makeText(this, "Đã ghép · " + profile.employeeId + " ONLINE", Toast.LENGTH_LONG).show();
                    button.setEnabled(true); button.setText("Ghép Controller"); refreshStatus();
                });
            } catch (Exception error) {
                String raw = error.getMessage();
                String message = raw == null || raw.trim().isEmpty() ? error.getClass().getSimpleName() : raw;
                writeControllerStatus("OFFLINE", 0L, message.length() > 160 ? message.substring(0, 160) : message);
                runOnUiThread(() -> {
                    Toast.makeText(this, friendlyPairingError(message), Toast.LENGTH_LONG).show();
                    button.setEnabled(true); button.setText("Ghép Controller"); refreshStatus();
                });
            }
        });
    }

    private void refreshStatus() {
        EmployeeProfileStore.Profile profile = profileStore.load();
        boolean accessibility = accessibilityEnabled();
        boolean notificationGranted = Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        String currentState = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE).getString(ForegroundWorkerService.KEY_CONTROLLER_STATE, "UNPAIRED");
        long lastHeartbeat = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE).getLong(ForegroundWorkerService.KEY_LAST_HEARTBEAT_AT, 0L);
        String lastPackage = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE).getString(AccessibilityBridgeService.KEY_LAST_PACKAGE, "Chưa quan sát");
        String lastError = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE).getString(ForegroundWorkerService.KEY_LAST_ERROR, "");
        boolean paired;
        try { paired = new SecureCredentialStore(this).load() != null; } catch (Exception ignored) { paired = false; }

        if (accessState != null) {
            accessState.setText((notificationGranted ? "Thông báo: đã cho phép · " : "Cần cho phép thông báo · ") + (accessibility ? "Accessibility: đã bật" : "Accessibility: chưa bật"));
            accessState.setTextColor(notificationGranted && accessibility ? GREEN : MUTED);
            tailscaleState.setText("Mở Tailscale để xác nhận thiết bị đã vào mạng riêng");
            controllerState.setText(paired ? "Đã ghép · Controller " + currentState : "Chưa ghép · PC01 Controller chưa có bằng chứng online");
            controllerState.setTextColor(paired && "ONLINE".equals(currentState) ? GREEN : MUTED);
        }
        String heartbeat = lastHeartbeat > 0 ? ((System.currentTimeMillis() - lastHeartbeat) / 1000L) + " giây trước" : "Chưa có";
        String readiness = paired && "ONLINE".equals(currentState) && accessibility ? "NHÂN VIÊN ONLINE" : "CHƯA SẴN SÀNG NHẬN VIỆC";
        readinessView.setText(readiness + "\n" + (paired ? "Thiết bị đã ghép; đang chờ task hợp lệ." : "Hoàn tất quyền, Tailscale và ghép Controller để bắt đầu."));
        readinessView.setTextColor(paired && "ONLINE".equals(currentState) ? GREEN : RED);
        readinessView.setBackground(roundRect(paired && "ONLINE".equals(currentState) ? Color.rgb(230, 248, 239) : Color.rgb(255, 239, 237), 16));

        statusView.setText("Nhân viên: " + profile.employeeId + " · " + profile.department + " / " + profile.role
            + "\nAI làm việc: " + profile.provider
            + "\nRuntime: ACTIVE"
            + "\nAccessibility: " + (accessibility ? "ĐÃ BẬT" : "CHƯA BẬT")
            + "\nController: " + (paired ? "ĐÃ GHÉP · " + currentState : "CHƯA GHÉP")
            + "\nHeartbeat: " + heartbeat
            + "\nỨng dụng đang thấy: " + lastPackage
            + (lastError == null || lastError.isEmpty() ? "" : "\nLỗi gần nhất: " + lastError));
    }

    private void showConnectionGuide() {
        new AlertDialog.Builder(this)
            .setTitle("Kết nối TigerIQ Worker")
            .setMessage("1. Lưu hồ sơ nhân viên.\n\n2. Bật quyền điều khiển hỗ trợ trong Cài đặt Android, rồi quay lại app.\n\n3. Mở Tailscale, đăng nhập đúng tailnet TigerIQ và bảo đảm thiết bị hiện Connected.\n\n4. Khi PC01 Controller đã ONLINE, bấm Ghép Controller. App tự tạo khóa thiết bị và chỉ lưu credential mã hóa trên máy.\n\n5. Khi màn hình hiện NHÂN VIÊN ONLINE, Worker mới có thể nhận task an toàn.\n\nGemini chỉ được mở thủ công trước khi gate provider được duyệt.")
            .setPositiveButton("Đã hiểu", null)
            .show();
    }

    private void writeControllerStatus(String state, long heartbeatAt, String error) {
        getSharedPreferences(ForegroundWorkerService.PREFS, Context.MODE_PRIVATE).edit()
            .putString(ForegroundWorkerService.KEY_CONTROLLER_STATE, state)
            .putLong(ForegroundWorkerService.KEY_LAST_HEARTBEAT_AT, heartbeatAt)
            .putString(ForegroundWorkerService.KEY_LAST_ERROR, error).apply();
    }

    private String friendlyPairingError(String message) {
        String lower = message.toLowerCase();
        if (lower.contains("failed to connect") || lower.contains("connect") || lower.contains("timeout") || lower.contains("unreachable")) return "Chưa thấy PC01 Controller. Kiểm tra Tailscale rồi thử lại.";
        if (lower.contains("tailnet")) return "Thiết bị chưa được Controller nhận là peer Tailscale.";
        return "Chưa thể ghép: " + (message.length() > 90 ? message.substring(0, 90) : message);
    }

    private String currentControllerUrl() {
        try { SecureCredentialStore.Credential credential = new SecureCredentialStore(this).load(); if (credential != null) return credential.controllerUrl; } catch (Exception ignored) { }
        return DEFAULT_CONTROLLER;
    }

    private boolean accessibilityEnabled() {
        ComponentName component = new ComponentName(this, AccessibilityBridgeService.class);
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        for (String service : enabled.split(":")) {
            if (service.equalsIgnoreCase(component.flattenToString()) || service.equalsIgnoreCase(component.flattenToShortString())) return true;
        }
        return false;
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
    }

    private int batteryPct() {
        android.os.BatteryManager manager = (android.os.BatteryManager) getSystemService(Context.BATTERY_SERVICE);
        return manager == null ? 0 : Math.max(0, Math.min(100, manager.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)));
    }

    private void openTailscale() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn");
        if (launch != null) { startActivity(launch); return; }
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.tailscale.ipn"))); }
        catch (Exception ignored) { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.tailscale.ipn"))); }
    }

    private void openGemini() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.google.android.apps.bard");
        if (launch == null) launch = getPackageManager().getLaunchIntentForPackage("com.google.android.googlequicksearchbox");
        if (launch != null) { launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); startActivity(launch); return; }
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://gemini.google.com/app")));
    }

    private void startWorkerService() {
        Intent intent = new Intent(this, ForegroundWorkerService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent); else startService(intent);
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackground(roundRect(Color.WHITE, 16));
        return card;
    }

    private EditText field(String hint, String value, boolean uri) {
        EditText edit = new EditText(this);
        edit.setHint(hint); edit.setText(value); edit.setSingleLine(true);
        edit.setTextColor(INK); edit.setHintTextColor(MUTED);
        edit.setInputType(uri ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI : InputType.TYPE_CLASS_TEXT);
        edit.setPadding(dp(12), dp(8), dp(12), dp(8));
        edit.setBackground(roundRect(Color.rgb(243, 245, 249), 12));
        edit.setLayoutParams(marginParams(0, 0, 0, dp(8)));
        return edit;
    }

    private Button primaryButton(String label) {
        Button button = baseButton(label, ORANGE, Color.WHITE);
        return button;
    }

    private Button secondaryButton(String label) {
        return baseButton(label, Color.rgb(243, 245, 249), INK);
    }

    private Button baseButton(String label, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label); button.setTextColor(foreground); button.setTextSize(13); button.setAllCaps(false);
        button.setTypeface(button.getTypeface(), Typeface.BOLD);
        button.setBackground(roundRect(background, 12));
        button.setPadding(dp(12), dp(10), dp(12), dp(10));
        button.setMinHeight(0); button.setMinimumHeight(0);
        return button;
    }

    private TextView sectionTitle(String value) {
        TextView view = text(value, 16, true);
        view.setTextColor(INK);
        view.setPadding(0, 0, 0, dp(4));
        return view;
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value); view.setTextSize(sp); view.setTextColor(INK);
        if (bold) view.setTypeface(view.getTypeface(), Typeface.BOLD);
        return view;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color); drawable.setCornerRadius(dp(radiusDp)); return drawable;
    }

    private LinearLayout.LayoutParams marginParams(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom)); return params;
    }

    private LinearLayout.LayoutParams fixedParams(int width, int height, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom)); return params;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
