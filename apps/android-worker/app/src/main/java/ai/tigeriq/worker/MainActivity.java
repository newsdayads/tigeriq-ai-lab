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
import android.view.Gravity;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Clear pilot onboarding/status surface for one TigerIQ Android worker node. */
public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final String DEFAULT_CONTROLLER = "http://100.97.23.87:8795";
    private static final String SETUP_PREFS = "tigeriq-worker-setup";
    private static final String KEY_NETWORK_OK = "networkOk";
    private static final String KEY_NETWORK_PROBE_AT = "networkProbeAt";

    private static final int INK = Color.rgb(20, 30, 45);
    private static final int MUTED = Color.rgb(93, 108, 128);
    private static final int ORANGE = Color.rgb(242, 121, 40);
    private static final int GOLD = Color.rgb(255, 190, 67);
    private static final int GREEN = Color.rgb(20, 137, 97);
    private static final int RED = Color.rgb(189, 57, 57);

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();
    private EmployeeProfileStore profileStore;
    private Spinner providerSpinner;
    private TextView readinessView;
    private TextView assignmentView;
    private TextView roleView;
    private TextView accessState;
    private TextView networkState;
    private TextView controllerState;
    private TextView statusView;

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
        root.addView(readinessView, marginParams(0, dp(14), 0, dp(18)));

        root.addView(sectionTitle("Thiết lập pilot"));
        root.addView(text("Không cần nhập phòng ban/vai trò. Thiết bị tự có ID; TigerIQ Core cấp mã NV khi ghép.", 13, false));

        LinearLayout profileCard = card();
        String nodeId = new NodeIdentityStore(this).getOrCreate();
        profileCard.addView(label("Thiết bị"));
        profileCard.addView(value(nodeId + "\n" + Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE));

        profileCard.addView(label("Nhân viên"), marginParams(0, dp(12), 0, 0));
        assignmentView = value("Chưa cấp — Core sẽ cấp khi ghép");
        profileCard.addView(assignmentView);

        profileCard.addView(label("Vai trò"), marginParams(0, dp(12), 0, 0));
        roleView = value("Core sẽ cấp theo Registry");
        profileCard.addView(roleView);

        profileCard.addView(label("AI làm việc"), marginParams(0, dp(12), 0, dp(4)));
        providerSpinner = new Spinner(this);
        ArrayAdapter<String> providerAdapter = new ArrayAdapter<>(
            this,
            android.R.layout.simple_spinner_item,
            new String[]{"ChatGPT", "Gemini"}
        );
        providerAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        providerSpinner.setAdapter(providerAdapter);
        providerSpinner.setSelection("Gemini".equals(profileStore.load().provider) ? 1 : 0);
        providerSpinner.setBackground(roundRect(Color.rgb(243, 245, 249), 12));
        providerSpinner.setPadding(dp(12), dp(8), dp(12), dp(8));
        profileCard.addView(providerSpinner);

        Button saveProvider = primaryButton("Lưu AI đã chọn");
        saveProvider.setOnClickListener(v -> {
            profileStore.saveProvider(selectedProvider());
            Toast.makeText(this, "Đã lưu AI: " + selectedProvider(), Toast.LENGTH_SHORT).show();
            refreshStatus();
        });
        profileCard.addView(saveProvider, marginParams(0, dp(10), 0, 0));
        root.addView(profileCard, marginParams(0, dp(8), 0, dp(20)));

        root.addView(sectionTitle("Kết nối theo 3 bước"));
        root.addView(text("Làm lần lượt. Mỗi bước hiển thị trạng thái thật; không cần nhập địa chỉ Controller.", 13, false));

        LinearLayout setupCard = card();
        accessState = step(
            setupCard, "1", "Bật quyền điều khiển hỗ trợ",
            "Đang kiểm tra…", "Mở Accessibility",
            v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        );
        networkState = step(
            setupCard, "2", "Kiểm tra mạng riêng tới PC01",
            "Chưa kiểm tra", "Kiểm tra",
            v -> probeController((Button) v)
        );
        controllerState = step(
            setupCard, "3", "Ghép với TigerIQ Core",
            "Chưa ghép", "Ghép ngay",
            v -> pairController((Button) v)
        );
        root.addView(setupCard, marginParams(0, dp(8), 0, dp(10)));

        TextView controllerTarget = text("TigerIQ Core cố định: PC01 · 100.97.23.87:8795", 12, false);
        controllerTarget.setTextColor(MUTED);
        root.addView(controllerTarget);

        Button tailscale = secondaryButton("Mở Tailscale");
        tailscale.setOnClickListener(v -> openTailscale());
        root.addView(tailscale, marginParams(0, dp(10), 0, dp(16)));

        Button guide = secondaryButton("Xem đúng thứ tự cài đặt");
        guide.setOnClickListener(v -> showConnectionGuide());
        root.addView(guide, marginParams(0, 0, 0, dp(20)));

        root.addView(sectionTitle("Kiểm tra AI trên máy"));
        LinearLayout tools = card();
        Button openProvider = secondaryButton("Mở AI đã chọn");
        openProvider.setOnClickListener(v -> openSelectedProvider());
        tools.addView(openProvider);
        Button refresh = secondaryButton("Làm mới trạng thái sau khi mở AI");
        refresh.setOnClickListener(v -> refreshStatus());
        tools.addView(refresh, marginParams(0, dp(8), 0, 0));
        root.addView(tools, marginParams(0, dp(8), 0, dp(20)));

        root.addView(sectionTitle("Trạng thái thiết bị"));
        LinearLayout statusCard = card();
        statusView = text("", 14, false);
        statusCard.addView(statusView);
        root.addView(statusCard, marginParams(0, dp(8), 0, dp(12)));

        TextView boundary = text(
            "v0.7 Core Mobile: kiểm tra kết nối + Accessibility + cây giao diện AI. Chưa bật tự gửi lệnh hoặc tự đọc nội dung hội thoại.",
            12, false
        );
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
        TextView label = text("WORKER · PILOT SETUP", 11, true);
        label.setTextColor(GOLD);
        words.addView(label, marginParams(0, dp(2), 0, 0));
        header.addView(words, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        return header;
    }

    private TextView step(
        LinearLayout parent,
        String number,
        String title,
        String state,
        String action,
        View.OnClickListener listener
    ) {
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

        parent.addView(row, marginParams(0, 0, 0, dp(16)));
        return stateView;
    }

    private void probeController(Button button) {
        button.setEnabled(false);
        button.setText("Đang kiểm tra…");
        networkExecutor.execute(() -> {
            try {
                ControllerClient client = new ControllerClient(new SecureCredentialStore(this));
                JSONObject response = client.probeStatus(currentControllerUrl());
                if (!response.optBoolean("ok", false)) throw new IllegalStateException("controller did not return ok");
                writeNetworkProbe(true);
                runOnUiThread(() -> {
                    Toast.makeText(this, "Đã thấy TigerIQ Core trên PC01 qua mạng riêng", Toast.LENGTH_SHORT).show();
                    button.setEnabled(true);
                    button.setText("Kiểm tra");
                    refreshStatus();
                });
            } catch (Exception error) {
                writeNetworkProbe(false);
                runOnUiThread(() -> {
                    Toast.makeText(this, "Chưa thấy PC01. Mở Tailscale rồi kiểm tra lại.", Toast.LENGTH_LONG).show();
                    button.setEnabled(true);
                    button.setText("Kiểm tra");
                    refreshStatus();
                });
            }
        });
    }

    private void pairController(Button button) {
        final String provider = selectedProvider();
        profileStore.saveProvider(provider);
        button.setEnabled(false);
        button.setText("Đang ghép…");

        networkExecutor.execute(() -> {
            try {
                String target = ControllerUrlPolicy.requireTrusted(currentControllerUrl());
                SecureCredentialStore secureStore = new SecureCredentialStore(this);
                ControllerClient client = new ControllerClient(secureStore);
                String nodeId = new NodeIdentityStore(this).getOrCreate();

                if (secureStore.load() == null) {
                    JSONObject pairing = client.requestPairingChallenge(target).getJSONObject("pairing");
                    client.pair(
                        target,
                        pairing.getString("challengeId"),
                        pairing.getString("challenge"),
                        nodeId,
                        Build.MANUFACTURER + " " + Build.MODEL + " / Android " + Build.VERSION.RELEASE,
                        WorkerVersion.NAME,
                        capabilities(provider)
                    );
                }

                JSONObject registration = client.requestCoreAssignedEmployee(provider, capabilities(provider));
                JSONObject employee = registration.getJSONObject("employee");
                profileStore.saveAssignedEmployee(
                    employee.getString("employeeId"),
                    employee.getString("department"),
                    employee.getString("role"),
                    employee.optString("provider", provider)
                );
                client.heartbeat(batteryPct(), null, WorkerVersion.NAME);
                writeNetworkProbe(true);
                writeControllerStatus("ONLINE", System.currentTimeMillis(), "");

                runOnUiThread(() -> {
                    Toast.makeText(
                        this,
                        "Đã ghép · Core cấp " + employee.optString("employeeId", "NV"),
                        Toast.LENGTH_LONG
                    ).show();
                    button.setEnabled(true);
                    button.setText("Ghép ngay");
                    refreshStatus();
                });
            } catch (Exception error) {
                String raw = error.getMessage();
                String message = raw == null || raw.trim().isEmpty() ? error.getClass().getSimpleName() : raw;
                writeControllerStatus("OFFLINE", 0L, message.length() > 160 ? message.substring(0, 160) : message);

                runOnUiThread(() -> {
                    Toast.makeText(this, friendlyPairingError(message), Toast.LENGTH_LONG).show();
                    button.setEnabled(true);
                    button.setText("Ghép ngay");
                    refreshStatus();
                });
            }
        });
    }

    private void refreshStatus() {
        EmployeeProfileStore.Profile profile = profileStore.load();
        boolean accessibility = accessibilityEnabled();
        boolean notificationGranted =
            Build.VERSION.SDK_INT < 33
                || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;

        String currentState = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE)
            .getString(ForegroundWorkerService.KEY_CONTROLLER_STATE, "UNPAIRED");
        long lastHeartbeat = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE)
            .getLong(ForegroundWorkerService.KEY_LAST_HEARTBEAT_AT, 0L);
        String lastPackage = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE)
            .getString(AccessibilityBridgeService.KEY_LAST_PACKAGE, "Chưa quan sát");
        boolean semanticRoot = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE)
            .getBoolean(AccessibilityBridgeService.KEY_ROOT_AVAILABLE, false);
        int semanticNodes = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE)
            .getInt(AccessibilityBridgeService.KEY_NODE_COUNT, 0);
        int editableNodes = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE)
            .getInt(AccessibilityBridgeService.KEY_EDITABLE_COUNT, 0);
        int clickableNodes = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE)
            .getInt(AccessibilityBridgeService.KEY_CLICKABLE_COUNT, 0);
        String lastError = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE)
            .getString(ForegroundWorkerService.KEY_LAST_ERROR, "");

        boolean paired;
        try {
            paired = new SecureCredentialStore(this).load() != null;
        } catch (Exception ignored) {
            paired = false;
        }

        boolean networkOk = getSharedPreferences(SETUP_PREFS, MODE_PRIVATE).getBoolean(KEY_NETWORK_OK, false);
        long networkProbeAt = getSharedPreferences(SETUP_PREFS, MODE_PRIVATE).getLong(KEY_NETWORK_PROBE_AT, 0L);
        if (paired && "ONLINE".equals(currentState)) networkOk = true;

        assignmentView.setText(profile.assigned() ? profile.employeeId : "Chưa cấp — Core sẽ cấp khi ghép");
        roleView.setText(profile.assigned() ? profile.department + " · " + profile.role : "Core sẽ cấp theo Registry");

        accessState.setText(
            "Accessibility: " + (accessibility ? "ĐÃ BẬT" : "CHƯA BẬT")
                + " · Thông báo: " + (notificationGranted ? "ĐÃ CHO PHÉP" : "CHƯA CHO PHÉP")
        );
        accessState.setTextColor(accessibility && notificationGranted ? GREEN : MUTED);

        String networkAge = networkProbeAt > 0
            ? " · " + Math.max(0L, (System.currentTimeMillis() - networkProbeAt) / 1000L) + " giây trước"
            : "";
        networkState.setText(networkOk ? "ĐÃ THẤY PC01 qua mạng riêng" + networkAge : "CHƯA XÁC MINH đường mạng tới PC01");
        networkState.setTextColor(networkOk ? GREEN : MUTED);

        controllerState.setText(
            paired
                ? "ĐÃ GHÉP · " + translateControllerState(currentState)
                : "CHƯA GHÉP · Core chưa cấp mã NV"
        );
        controllerState.setTextColor(paired && "ONLINE".equals(currentState) ? GREEN : MUTED);

        String missing = firstMissing(accessibility, notificationGranted, networkOk, paired, profile.assigned(), currentState);
        boolean ready = missing == null;
        readinessView.setText(
            ready
                ? "SẴN SÀNG KIỂM TRA AI\n" + profile.employeeId + " · " + profile.provider + " · PC01 TRỰC TUYẾN"
                : "CHƯA SẴN SÀNG\nThiếu: " + missing
        );
        readinessView.setTextColor(ready ? GREEN : RED);
        readinessView.setBackground(roundRect(ready ? Color.rgb(230, 248, 239) : Color.rgb(255, 239, 237), 16));

        String heartbeat = lastHeartbeat > 0
            ? Math.max(0L, (System.currentTimeMillis() - lastHeartbeat) / 1000L) + " giây trước"
            : "Chưa có";

        statusView.setText(
            "Phiên bản: " + WorkerVersion.NAME
                + "\nThiết bị: " + new NodeIdentityStore(this).getOrCreate()
                + "\nMáy: " + Build.MANUFACTURER + " " + Build.MODEL + " · Android " + Build.VERSION.RELEASE
                + "\nNhân viên: " + (profile.assigned() ? profile.employeeId : "CHƯA CẤP")
                + "\nVai trò: " + (profile.assigned() ? profile.department + " / " + profile.role : "CHƯA CẤP")
                + "\nAI làm việc: " + profile.provider
                + "\nDịch vụ nền: ĐÃ KHỞI ĐỘNG"
                + "\nAccessibility: " + (accessibility ? "ĐÃ BẬT" : "CHƯA BẬT")
                + "\nMạng PC01: " + (networkOk ? "ĐÃ XÁC MINH" : "CHƯA XÁC MINH")
                + "\nController: " + (paired ? "ĐÃ GHÉP · " + translateControllerState(currentState) : "CHƯA GHÉP")
                + "\nHeartbeat: " + heartbeat
                + "\nỨng dụng đang thấy: " + lastPackage
                + "\nCây Accessibility: " + (semanticRoot ? "CÓ" : "CHƯA THẤY")
                + "\nNode: " + semanticNodes + " · Editable: " + editableNodes + " · Clickable: " + clickableNodes
                + (lastError == null || lastError.isEmpty() ? "" : "\nLỗi gần nhất: " + lastError)
        );
    }

    private String firstMissing(
        boolean accessibility,
        boolean notificationGranted,
        boolean networkOk,
        boolean paired,
        boolean assigned,
        String controllerState
    ) {
        if (!accessibility) return "quyền điều khiển hỗ trợ";
        if (!notificationGranted) return "quyền thông báo";
        if (!networkOk) return "kết nối PC01/Tailscale";
        if (!paired) return "ghép TigerIQ Core";
        if (!assigned) return "Core cấp mã nhân viên";
        if (!"ONLINE".equals(controllerState)) return "TigerIQ Core trực tuyến";
        return null;
    }

    private void showConnectionGuide() {
        new AlertDialog.Builder(this)
            .setTitle("Thứ tự cài TigerIQ Worker")
            .setMessage(
                "1. Chọn ChatGPT hoặc Gemini và bấm Lưu AI đã chọn.\n\n"
                    + "2. Bấm Mở Accessibility → bật TigerIQ Worker → quay lại app.\n\n"
                    + "3. Nếu Tailscale chưa Connected, bấm Mở Tailscale và kết nối.\n\n"
                    + "4. Bấm Kiểm tra. Chỉ khi app báo ĐÃ THẤY PC01 mới qua bước tiếp theo.\n\n"
                    + "5. Bấm Ghép ngay. Core tự cấp mã NV + phòng ban + vai trò; không nhập tay.\n\n"
                    + "6. Bấm Mở AI đã chọn, chờ khoảng 10 giây rồi quay lại và bấm Làm mới trạng thái.\n\n"
                    + "7. Gate B0 đạt khi app nhìn thấy đúng provider và cây Accessibility có node thực tế."
            )
            .setPositiveButton("Đã hiểu", null)
            .show();
    }

    private void writeNetworkProbe(boolean ok) {
        getSharedPreferences(SETUP_PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_NETWORK_OK, ok)
            .putLong(KEY_NETWORK_PROBE_AT, System.currentTimeMillis())
            .apply();
    }

    private void writeControllerStatus(String state, long heartbeatAt, String error) {
        getSharedPreferences(ForegroundWorkerService.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(ForegroundWorkerService.KEY_CONTROLLER_STATE, state)
            .putLong(ForegroundWorkerService.KEY_LAST_HEARTBEAT_AT, heartbeatAt)
            .putString(ForegroundWorkerService.KEY_LAST_ERROR, error)
            .apply();
    }

    private String friendlyPairingError(String message) {
        String lower = message.toLowerCase();
        if (lower.contains("failed to connect") || lower.contains("connect") || lower.contains("timeout") || lower.contains("unreachable")) {
            return "Chưa thấy PC01 Controller. Mở Tailscale, bấm Kiểm tra rồi thử lại.";
        }
        if (lower.contains("tailnet")) return "Thiết bị chưa được Controller nhận là peer Tailscale.";
        if (lower.contains("already_registered")) return "Thiết bị đã từng ghép nhưng credential local không khớp. Dừng tại đây để kiểm tra binding.";
        return "Chưa thể ghép: " + (message.length() > 110 ? message.substring(0, 110) : message);
    }

    private String currentControllerUrl() {
        try {
            SecureCredentialStore.Credential credential = new SecureCredentialStore(this).load();
            if (credential != null) return credential.controllerUrl;
        } catch (Exception ignored) {
            // Fall through to canonical pilot controller.
        }
        return DEFAULT_CONTROLLER;
    }

    private boolean accessibilityEnabled() {
        ComponentName component = new ComponentName(this, AccessibilityBridgeService.class);
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        for (String service : enabled.split(":")) {
            if (service.equalsIgnoreCase(component.flattenToString())
                || service.equalsIgnoreCase(component.flattenToShortString())) {
                return true;
            }
        }
        return false;
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33
            && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        }
    }

    private int batteryPct() {
        android.os.BatteryManager manager = (android.os.BatteryManager) getSystemService(Context.BATTERY_SERVICE);
        return manager == null ? 0 : Math.max(0, Math.min(100, manager.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)));
    }

    private String[] capabilities(String provider) {
        return "Gemini".equals(provider)
            ? new String[]{"android-ui", "research", "gemini-ui"}
            : new String[]{"android-ui", "research", "chatgpt-ui"};
    }

    private String selectedProvider() {
        if (providerSpinner == null || providerSpinner.getSelectedItem() == null) return profileStore.load().provider;
        return EmployeeProfileStore.normalizeProvider(providerSpinner.getSelectedItem().toString());
    }

    private void openSelectedProvider() {
        profileStore.saveProvider(selectedProvider());
        if ("Gemini".equals(selectedProvider())) openGemini();
        else openChatGpt();
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

    private void openChatGpt() {
        Intent launch = getPackageManager().getLaunchIntentForPackage("com.openai.chatgpt");
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(launch);
            return;
        }
        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://chatgpt.com/")));
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

    private String translateControllerState(String state) {
        if ("ONLINE".equals(state)) return "TRỰC TUYẾN";
        if ("OFFLINE".equals(state)) return "NGOẠI TUYẾN";
        return "CHƯA XÁC ĐỊNH";
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackground(roundRect(Color.WHITE, 16));
        return card;
    }

    private TextView label(String value) {
        TextView view = text(value, 12, true);
        view.setTextColor(MUTED);
        return view;
    }

    private TextView value(String value) {
        TextView view = text(value, 14, false);
        view.setPadding(0, dp(3), 0, 0);
        return view;
    }

    private Button primaryButton(String label) {
        return baseButton(label, ORANGE, Color.WHITE);
    }

    private Button secondaryButton(String label) {
        return baseButton(label, Color.rgb(243, 245, 249), INK);
    }

    private Button baseButton(String label, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(foreground);
        button.setTextSize(13);
        button.setAllCaps(false);
        button.setTypeface(button.getTypeface(), Typeface.BOLD);
        button.setBackground(roundRect(background, 12));
        button.setPadding(dp(12), dp(10), dp(12), dp(10));
        button.setMinHeight(0);
        button.setMinimumHeight(0);
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
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(INK);
        if (bold) view.setTypeface(view.getTypeface(), Typeface.BOLD);
        return view;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private LinearLayout.LayoutParams marginParams(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private LinearLayout.LayoutParams fixedParams(int width, int height, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.setMargins(dp(left), dp(top), dp(right), dp(bottom));
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
