package ai.tigeriq.worker;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
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

/** TigerIQ AI Mobile Worker pilot console. */
public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final String CORE_URL = "http://100.97.23.87:8795";
    private static final String SETUP_PREFS = "tigeriq-worker-setup";
    private static final String KEY_NETWORK_OK = "networkOk";
    private static final String KEY_NETWORK_PROBE_AT = "networkProbeAt";

    // Canonical TigerIQ palette from Web Control.
    private static final int BG = Color.rgb(6, 16, 31);          // #06101F
    private static final int PANEL = Color.rgb(11, 26, 47);     // #0B1A2F
    private static final int PANEL_2 = Color.rgb(13, 34, 61);   // #0D223D
    private static final int LINE = Color.rgb(22, 75, 122);     // #164B7A
    private static final int CYAN = Color.rgb(44, 188, 255);    // #2CBCFF
    private static final int BLUE = Color.rgb(59, 130, 246);    // #3B82F6
    private static final int GREEN = Color.rgb(40, 223, 145);   // #28DF91
    private static final int AMBER = Color.rgb(255, 189, 70);   // #FFBD46
    private static final int RED = Color.rgb(255, 94, 109);     // #FF5E6D
    private static final int MUTED = Color.rgb(143, 169, 199);  // #8FA9C7
    private static final int TEXT = Color.rgb(239, 247, 255);   // #EFF7FF

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();

    private EmployeeProfileStore profileStore;
    private Spinner providerSpinner;
    private TextView readinessView;
    private TextView assignmentValue;
    private TextView roleValue;
    private TextView accessState;
    private TextView networkState;
    private TextView coreState;
    private TextView aiProbeState;
    private TextView b1StateView;
    private TextView technicalState;

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
        if (readinessView != null) {
            refreshStatus();
            syncRuntime(null, false);
            if (WorkerUpdateEngine.shouldResumeAfterPermission(this)) {
                networkExecutor.execute(() -> {
                    try {
                        WorkerUpdateEngine.checkAndInstall(this, true);
                    } catch (Exception error) {
                        WorkerUpdateEngine.markInstallCallback(this, "UPDATE_FAILED", safeError(error));
                    }
                    runOnUiThread(this::refreshStatus);
                });
            }
        }
    }

    @Override
    protected void onDestroy() {
        networkExecutor.shutdownNow();
        super.onDestroy();
    }

    private View buildScreen() {
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BG);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(14), dp(16), dp(28));
        root.setBackgroundColor(BG);
        scroll.addView(root);

        root.addView(brandHeader());

        readinessView = text("", 15, true);
        readinessView.setPadding(dp(14), dp(12), dp(14), dp(12));
        root.addView(readinessView, marginParams(0, dp(12), 0, dp(16)));

        root.addView(sectionTitle("Thiết bị & nhân viên"));
        LinearLayout identity = card();
        addKeyValue(identity, "Thiết bị", shortNodeId() + " · " + Build.MANUFACTURER + " " + Build.MODEL);
        addKeyValue(identity, "Hệ điều hành", "Android " + Build.VERSION.RELEASE);
        assignmentValue = addKeyValue(identity, "Nhân viên", "Chưa cấp");
        roleValue = addKeyValue(identity, "Vai trò", "Chưa cấp");

        TextView providerLabel = label("AI làm việc");
        identity.addView(providerLabel, marginParams(0, dp(10), 0, dp(4)));
        providerSpinner = new Spinner(this);
        ArrayAdapter<String> providerAdapter = new ArrayAdapter<>(
            this,
            android.R.layout.simple_spinner_item,
            new String[]{"ChatGPT", "Gemini"}
        );
        providerAdapter.setDropDownViewResource(android.R.layout.simple_spinner_dropdown_item);
        providerSpinner.setAdapter(providerAdapter);
        providerSpinner.setSelection("Gemini".equals(profileStore.load().provider) ? 1 : 0);
        providerSpinner.setBackground(panelBox(PANEL_2, LINE, 10));
        providerSpinner.setPadding(dp(10), dp(6), dp(10), dp(6));
        identity.addView(providerSpinner);

        Button saveProvider = primaryButton("Lưu AI đã chọn");
        saveProvider.setOnClickListener(v -> {
            profileStore.saveProvider(selectedProvider());
            Toast.makeText(this, "Đã lưu " + selectedProvider(), Toast.LENGTH_SHORT).show();
            syncRuntime(null, true);
        });
        identity.addView(saveProvider, marginParams(0, dp(10), 0, 0));
        root.addView(identity, marginParams(0, dp(6), 0, dp(16)));

        root.addView(sectionTitle("Kết nối TigerIQ"));
        LinearLayout setup = card();
        accessState = step(
            setup, "01", "Accessibility",
            "Đang kiểm tra", "Mở cài đặt",
            v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        );
        networkState = step(
            setup, "02", "TigerIQ Core · PC01",
            "Chưa kiểm tra", "Kiểm tra",
            v -> probeCore((Button) v)
        );
        coreState = step(
            setup, "03", "Ghép Worker",
            "Chưa ghép", "Ghép ngay",
            v -> pairCore((Button) v)
        );
        TextView target = text("PC01 · 100.97.23.87:8795 · Tailscale", 11, false);
        target.setTextColor(MUTED);
        setup.addView(target, marginParams(0, dp(2), 0, 0));
        root.addView(setup, marginParams(0, dp(6), 0, dp(10)));

        LinearLayout networkActions = horizontal();
        Button tailscale = secondaryButton("Tailscale");
        tailscale.setOnClickListener(v -> openTailscale());
        networkActions.addView(tailscale, weightedParams(1f, 0, 0, dp(4), 0));
        Button sync = secondaryButton("Đồng bộ ngay");
        sync.setOnClickListener(v -> syncRuntime((Button) v, true));
        networkActions.addView(sync, weightedParams(1f, dp(4), 0, 0, 0));
        root.addView(networkActions, marginParams(0, 0, 0, dp(16)));

        root.addView(sectionTitle("Kiểm tra AI"));
        LinearLayout aiCard = card();
        TextView help = text(
            "Mở đúng ứng dụng AI, chờ vài giây rồi quay lại. TigerIQ giữ lại snapshot AI cuối cùng dù Android Launcher/Recent Apps phát sinh sự kiện sau đó.",
            12, false
        );
        help.setTextColor(MUTED);
        aiCard.addView(help);

        LinearLayout aiActions = horizontal();
        Button openAi = primaryButton("Mở AI đã chọn");
        openAi.setOnClickListener(v -> openSelectedProvider());
        aiActions.addView(openAi, weightedParams(1f, 0, dp(10), dp(4), 0));
        Button refreshAi = secondaryButton("Đọc kết quả");
        refreshAi.setOnClickListener(v -> {
            refreshStatus();
            syncRuntime(null, false);
        });
        aiActions.addView(refreshAi, weightedParams(1f, dp(4), dp(10), 0, 0));
        aiCard.addView(aiActions);

        aiProbeState = text("", 13, false);
        aiCard.addView(aiProbeState, marginParams(0, dp(12), 0, 0));
        root.addView(aiCard, marginParams(0, dp(6), 0, dp(16)));

        root.addView(sectionTitle("B1 · ChatGPT Adapter"));
        LinearLayout b1Card = card();
        TextView b1Help = text(
            "DEV pilot: TigerIQ tự mở ChatGPT, tự vào Project TigerIQ AI Lab bằng Accessibility semantic, rồi mới điền/gửi. App chờ 5 giây sau khi điền, nghỉ 8 giây giữa các chu kỳ. Không dùng tọa độ, không nhận backlog, không ghi GitHub.",
            12,
            false
        );
        b1Help.setTextColor(MUTED);
        b1Card.addView(b1Help);

        LinearLayout b1Actions = horizontal();
        Button runOne = primaryButton("Chạy 1 test");
        runOne.setOnClickListener(v -> startB1Run(1));
        b1Actions.addView(runOne, weightedParams(1f, 0, dp(10), dp(4), 0));
        Button runTen = secondaryButton("Chạy 10 test");
        runTen.setOnClickListener(v -> startB1Run(10));
        b1Actions.addView(runTen, weightedParams(1f, dp(4), dp(10), 0, 0));
        b1Card.addView(b1Actions);

        Button cancelB1 = secondaryButton("Hủy B1 đang chạy");
        cancelB1.setOnClickListener(v -> {
            ChatGptB1RunStore.cancel(this);
            refreshStatus();
        });
        b1Card.addView(cancelB1, marginParams(0, dp(8), 0, 0));

        b1StateView = text("", 13, false);
        b1Card.addView(b1StateView, marginParams(0, dp(12), 0, 0));
        root.addView(b1Card, marginParams(0, dp(6), 0, dp(16)));

        root.addView(sectionTitle("Hệ thống"));
        LinearLayout systemCard = card();
        technicalState = text("", 12, false);
        technicalState.setTextColor(MUTED);
        systemCard.addView(technicalState);

        Button update = secondaryButton("Cập nhật tự động");
        update.setOnClickListener(v -> checkForUpdate((Button) v));
        systemCard.addView(update, marginParams(0, dp(12), 0, 0));
        root.addView(systemCard, marginParams(0, dp(6), 0, dp(12)));

        TextView footer = text(
            WorkerVersion.NAME + " · B1 DEV · auto-update · auto-resume · pacing 5s/8s · chưa nhận backlog/GitHub write",
            11,
            false
        );
        footer.setTextColor(MUTED);
        footer.setGravity(Gravity.CENTER);
        root.addView(footer);
        return scroll;
    }

    private View brandHeader() {
        LinearLayout header = horizontal();
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(14), dp(13), dp(14), dp(13));
        header.setBackground(panelBox(PANEL, LINE, 16));

        TextView mark = text("🐯", 26, false);
        mark.setGravity(Gravity.CENTER);
        mark.setBackground(panelBox(Color.rgb(11, 15, 22), LINE, 12));
        header.addView(mark, fixedParams(dp(48), dp(48), 0, 0, dp(12), 0));

        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        TextView name = text("TigerIQ AI", 22, true);
        words.addView(name);
        TextView sub = text("MOBILE WORKER", 11, true);
        sub.setTextColor(CYAN);
        words.addView(sub, marginParams(0, dp(1), 0, 0));
        header.addView(words, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView version = text("v" + shortVersion(), 11, true);
        version.setTextColor(AMBER);
        version.setPadding(dp(9), dp(5), dp(9), dp(5));
        version.setBackground(panelBox(PANEL_2, LINE, 20));
        header.addView(version);
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
        LinearLayout row = horizontal();
        row.setGravity(Gravity.CENTER_VERTICAL);

        TextView numberView = text(number, 11, true);
        numberView.setTextColor(CYAN);
        numberView.setGravity(Gravity.CENTER);
        numberView.setBackground(panelBox(PANEL_2, LINE, 10));
        row.addView(numberView, fixedParams(dp(38), dp(32), 0, 0, dp(10), 0));

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
        button.setPadding(dp(10), dp(7), dp(10), dp(7));
        button.setOnClickListener(listener);
        row.addView(button);

        parent.addView(row, marginParams(0, 0, 0, dp(15)));
        return stateView;
    }

    private void startB1Run(int cycles) {
        if (!"ChatGPT".equals(selectedProvider())) {
            Toast.makeText(this, "B1 hiện chỉ hỗ trợ ChatGPT", Toast.LENGTH_LONG).show();
            return;
        }
        if (!accessibilityEnabled()) {
            Toast.makeText(this, "Cần bật Accessibility trước khi chạy B1", Toast.LENGTH_LONG).show();
            return;
        }
        if (!hasCredential()) {
            Toast.makeText(this, "Cần ghép TigerIQ Core trước khi chạy B1", Toast.LENGTH_LONG).show();
            return;
        }
        ChatGptB1RunStore.start(this, cycles);
        refreshStatus();
        Toast.makeText(
            this,
            "TigerIQ sẽ tự mở menu và tự chọn Project \"" + ChatGptB1RunStore.REQUIRED_PROJECT + "\".",
            Toast.LENGTH_LONG
        ).show();
        openChatGpt();
    }

    private void probeCore(Button button) {
        if (button != null) {
            button.setEnabled(false);
            button.setText("Đang kiểm tra");
        }
        networkExecutor.execute(() -> {
            try {
                ControllerClient client = new ControllerClient(new SecureCredentialStore(this));
                JSONObject response = client.probeStatus(currentCoreUrl());
                if (!response.optBoolean("ok", false)) throw new IllegalStateException("core_health_not_ok");
                writeNetworkProbe(true);
                runOnUiThread(() -> {
                    if (button != null) {
                        button.setEnabled(true);
                        button.setText("Kiểm tra");
                    }
                    refreshStatus();
                    Toast.makeText(this, "TigerIQ Core đang trực tuyến", Toast.LENGTH_SHORT).show();
                });
            } catch (Exception error) {
                writeNetworkProbe(false);
                runOnUiThread(() -> {
                    if (button != null) {
                        button.setEnabled(true);
                        button.setText("Kiểm tra");
                    }
                    refreshStatus();
                    Toast.makeText(this, "Chưa kết nối được TigerIQ Core", Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void pairCore(Button button) {
        final String provider = selectedProvider();
        profileStore.saveProvider(provider);
        button.setEnabled(false);
        button.setText("Đang ghép");

        networkExecutor.execute(() -> {
            try {
                String target = ControllerUrlPolicy.requireTrusted(currentCoreUrl());
                SecureCredentialStore secureStore = new SecureCredentialStore(this);
                ControllerClient client = new ControllerClient(secureStore);
                String nodeId = new NodeIdentityStore(this).getOrCreate();

                client.probeStatus(target);
                writeNetworkProbe(true);

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

                syncAssignmentAndHeartbeat(client, provider);
                runOnUiThread(() -> {
                    button.setEnabled(true);
                    button.setText("Ghép ngay");
                    refreshStatus();
                    Toast.makeText(this, "Worker đã ghép TigerIQ Core", Toast.LENGTH_SHORT).show();
                });
            } catch (Exception error) {
                String message = safeError(error);
                writeRuntimeStatus("OFFLINE", existingHeartbeat(), message);
                runOnUiThread(() -> {
                    button.setEnabled(true);
                    button.setText("Ghép ngay");
                    refreshStatus();
                    Toast.makeText(this, friendlyCoreError(message), Toast.LENGTH_LONG).show();
                });
            }
        });
    }

    private void syncRuntime(Button button, boolean showToast) {
        if (button != null) {
            button.setEnabled(false);
            button.setText("Đang đồng bộ");
        }
        final String provider = selectedProvider();
        networkExecutor.execute(() -> {
            boolean coreReachable = false;
            String errorText = "";
            try {
                ControllerClient client = new ControllerClient(new SecureCredentialStore(this));
                JSONObject health = client.probeStatus(currentCoreUrl());
                coreReachable = health.optBoolean("ok", false);
                writeNetworkProbe(coreReachable);

                SecureCredentialStore.Credential credential = new SecureCredentialStore(this).load();
                if (credential != null) {
                    syncAssignmentAndHeartbeat(client, provider);
                }
            } catch (Exception error) {
                errorText = safeError(error);
                if (!coreReachable) writeNetworkProbe(false);
                if (hasCredential()) {
                    writeRuntimeStatus("OFFLINE", existingHeartbeat(), errorText);
                }
            }

            final boolean ok = coreReachable;
            final String finalError = errorText;
            runOnUiThread(() -> {
                if (button != null) {
                    button.setEnabled(true);
                    button.setText("Đồng bộ ngay");
                }
                refreshStatus();
                if (showToast) {
                    Toast.makeText(
                        this,
                        ok ? "Đã đồng bộ TigerIQ Core" : "Đồng bộ chưa thành công" + (finalError.isEmpty() ? "" : ": " + compact(finalError, 60)),
                        ok ? Toast.LENGTH_SHORT : Toast.LENGTH_LONG
                    ).show();
                }
            });
        });
    }

    private void syncAssignmentAndHeartbeat(ControllerClient client, String provider) throws Exception {
        JSONObject registration = client.requestCoreAssignedEmployee(provider, capabilities(provider));
        JSONObject employee = registration.getJSONObject("employee");
        profileStore.saveAssignedEmployee(
            employee.getString("employeeId"),
            employee.getString("department"),
            employee.getString("role"),
            employee.optString("provider", provider)
        );
        client.heartbeat(batteryPct(), null, WorkerVersion.NAME);
        writeRuntimeStatus("ONLINE", System.currentTimeMillis(), "");
    }

    private void refreshStatus() {
        EmployeeProfileStore.Profile profile = profileStore.load();
        boolean accessibility = accessibilityEnabled();
        boolean notificationGranted =
            Build.VERSION.SDK_INT < 33
                || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;

        android.content.SharedPreferences runtime = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE);
        String runtimeState = runtime.getString(ForegroundWorkerService.KEY_CONTROLLER_STATE, "UNPAIRED");
        long lastHeartbeat = runtime.getLong(ForegroundWorkerService.KEY_LAST_HEARTBEAT_AT, 0L);
        String lastError = runtime.getString(ForegroundWorkerService.KEY_LAST_ERROR, "");

        android.content.SharedPreferences a11y = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE);
        String lastAnyPackage = a11y.getString(AccessibilityBridgeService.KEY_LAST_PACKAGE, "Chưa quan sát");
        String providerPackage = a11y.getString(AccessibilityBridgeService.KEY_PROVIDER_PACKAGE, "");
        long providerEventAt = a11y.getLong(AccessibilityBridgeService.KEY_PROVIDER_EVENT_AT, 0L);
        boolean semanticRoot = a11y.getBoolean(AccessibilityBridgeService.KEY_ROOT_AVAILABLE, false);
        int semanticNodes = a11y.getInt(AccessibilityBridgeService.KEY_NODE_COUNT, 0);
        int editableNodes = a11y.getInt(AccessibilityBridgeService.KEY_EDITABLE_COUNT, 0);
        int clickableNodes = a11y.getInt(AccessibilityBridgeService.KEY_CLICKABLE_COUNT, 0);

        boolean paired;
        try {
            paired = new SecureCredentialStore(this).load() != null;
        } catch (Exception ignored) {
            paired = false;
        }

        android.content.SharedPreferences setup = getSharedPreferences(SETUP_PREFS, MODE_PRIVATE);
        boolean networkOk = setup.getBoolean(KEY_NETWORK_OK, false);
        long networkProbeAt = setup.getLong(KEY_NETWORK_PROBE_AT, 0L);
        if (paired && "ONLINE".equals(runtimeState)) networkOk = true;

        assignmentValue.setText(profile.assigned() ? profile.employeeId : "Chờ Core cấp");
        assignmentValue.setTextColor(profile.assigned() ? GREEN : MUTED);
        roleValue.setText(profile.assigned() ? profile.department + " · " + profile.role : "Chờ Core cấp");
        roleValue.setTextColor(profile.assigned() ? TEXT : MUTED);

        accessState.setText(
            (accessibility ? "ĐẠT" : "CHƯA BẬT")
                + " · Thông báo " + (notificationGranted ? "ĐẠT" : "CHƯA BẬT")
        );
        accessState.setTextColor(accessibility && notificationGranted ? GREEN : AMBER);

        networkState.setText(
            networkOk
                ? "ĐẠT · kiểm tra " + age(networkProbeAt)
                : "CHƯA KẾT NỐI"
        );
        networkState.setTextColor(networkOk ? GREEN : AMBER);

        coreState.setText(
            paired
                ? ("ONLINE".equals(runtimeState) ? "ĐẠT · TRỰC TUYẾN" : "ĐÃ GHÉP · TẠM NGOẠI TUYẾN")
                : "CHƯA GHÉP"
        );
        coreState.setTextColor(paired && "ONLINE".equals(runtimeState) ? GREEN : (paired ? AMBER : MUTED));

        boolean providerSeen = providerEventAt > 0 && !providerPackage.isEmpty();
        aiProbeState.setText(
            "AI đã quan sát: " + (providerSeen ? friendlyPackage(providerPackage) + " · " + age(providerEventAt) : "CHƯA THẤY")
                + "\nCây giao diện: " + (semanticRoot ? "CÓ" : "CHƯA THẤY")
                + " · Node " + semanticNodes
                + " · Editable " + editableNodes
                + " · Clickable " + clickableNodes
        );
        aiProbeState.setTextColor(providerSeen && semanticRoot && semanticNodes > 0 ? GREEN : MUTED);

        String missing = firstMissing(accessibility, notificationGranted, networkOk, paired, profile.assigned(), runtimeState);
        boolean ready = missing == null;
        readinessView.setText(
            ready
                ? "SẴN SÀNG KIỂM TRA AI\n" + profile.employeeId + " · " + profile.provider + " · Core trực tuyến"
                : "CHƯA SẴN SÀNG\n" + missing
        );
        readinessView.setTextColor(ready ? GREEN : AMBER);
        readinessView.setBackground(panelBox(ready ? Color.rgb(8, 56, 35) : Color.rgb(55, 45, 18), ready ? GREEN : AMBER, 14));

        ChatGptB1RunStore.Snapshot b1 = ChatGptB1RunStore.read(this);
        String b1Title = b1StateLabel(b1.state);
        String b1Progress = b1.targetCycles > 0
            ? b1.completedCycles + "/" + b1.targetCycles
            : "chưa chạy";
        String projectDiagMode = a11y.getString(AccessibilityBridgeService.KEY_PROJECT_GATE_MODE, "CHƯA CÓ");
        String projectDiag = a11y.getString(AccessibilityBridgeService.KEY_PROJECT_GATE_DIAG, "");
        long projectDiagAt = a11y.getLong(AccessibilityBridgeService.KEY_PROJECT_GATE_AT, 0L);
        b1StateView.setText(
            "Trạng thái: " + b1Title
                + "\nTiến độ: " + b1Progress
                + " · Đã gửi " + b1.sendCount
                + " · Chặn trùng " + b1.duplicateSendCount
                + "\nProject: " + (b1.projectBound ? "ĐÃ XÁC NHẬN · " + ChatGptB1RunStore.REQUIRED_PROJECT : "CHƯA XÁC NHẬN")
                + "\nDetector: " + projectDiagMode + (projectDiagAt > 0 ? " · " + age(projectDiagAt) : "")
                + (projectDiag.isEmpty() ? "" : "\nChi tiết detector: " + compact(projectDiag, 180))
                + "\nRecovery: " + b1.recoveryCount
                + " · Busy seen: " + (b1.busySeen ? "CÓ" : "CHƯA")
                + (b1.lastError == null || b1.lastError.isEmpty() ? "" : "\nLỗi: " + b1.lastError)
        );
        b1StateView.setTextColor(
            "COMPLETE".equals(b1.state) ? GREEN
                : ("ERROR".equals(b1.state) ? RED
                : (b1.active() ? AMBER : MUTED))
        );

        technicalState.setText(
            "Phiên bản: " + WorkerVersion.NAME
                + "\nNode: " + new NodeIdentityStore(this).getOrCreate()
                + "\nHeartbeat: " + (lastHeartbeat > 0 ? age(lastHeartbeat) : "chưa có")
                + "\nSự kiện Android gần nhất: " + friendlyPackage(lastAnyPackage)
                + "\nCập nhật: " + WorkerUpdateEngine.state(this)
                + (WorkerUpdateEngine.lastError(this).isEmpty() ? "" : "\nLỗi update: " + compact(WorkerUpdateEngine.lastError(this), 120))
                + (lastError == null || lastError.isEmpty() ? "" : "\nLỗi gần nhất: " + compact(lastError, 140))
        );
    }

    private String firstMissing(
        boolean accessibility,
        boolean notificationGranted,
        boolean networkOk,
        boolean paired,
        boolean assigned,
        String runtimeState
    ) {
        if (!accessibility) return "Cần bật Accessibility";
        if (!notificationGranted) return "Cần bật thông báo";
        if (!networkOk) return "Chưa thấy TigerIQ Core";
        if (!paired) return "Cần ghép Worker";
        if (!assigned) return "Đang chờ Core cấp mã NV";
        if (!"ONLINE".equals(runtimeState)) return "Core đang tạm ngoại tuyến";
        return null;
    }

    private void checkForUpdate(Button button) {
        button.setEnabled(false);
        button.setText("Đang cập nhật");
        networkExecutor.execute(() -> {
            String message;
            try {
                WorkerUpdateEngine.Result result = WorkerUpdateEngine.checkAndInstall(this, true);
                if ("UP_TO_DATE".equals(result.state)) message = "Đang dùng bản mới nhất";
                else if ("UPDATE_IN_PROGRESS".equals(result.state)) message = "Một lượt cập nhật khác đang chạy";
                else if ("NEEDS_INSTALL_PERMISSION".equals(result.state)) message = "Cho phép TigerIQ cài bản cập nhật một lần, sau đó app sẽ tự tiếp tục";
                else if ("DEFERRED_CORE_TASK".equals(result.state)) message = "Đang xử lý việc Core, cập nhật sẽ chờ";
                else if ("DEFERRED_B1_ACTIVE".equals(result.state)) message = "Đang chạy B1, cập nhật sẽ chờ";
                else if ("DEFERRED_EVIDENCE_PENDING".equals(result.state)) message = "Đang gửi bằng chứng, cập nhật sẽ chờ";
                else message = "Đã tải và gửi bản cập nhật cho Android";
            } catch (Exception error) {
                WorkerUpdateEngine.markInstallCallback(this, "UPDATE_FAILED", safeError(error));
                message = "Cập nhật lỗi: " + compact(safeError(error), 80);
            }
            final String toast = message;
            runOnUiThread(() -> {
                button.setEnabled(true);
                button.setText("Cập nhật tự động");
                refreshStatus();
                Toast.makeText(this, toast, Toast.LENGTH_LONG).show();
            });
        });
    }

    private long currentVersionCode() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            if (Build.VERSION.SDK_INT >= 28) return info.getLongVersionCode();
            return info.versionCode;
        } catch (Exception ignored) {
            return 0L;
        }
    }

    private String currentCoreUrl() {
        try {
            SecureCredentialStore.Credential credential = new SecureCredentialStore(this).load();
            if (credential != null) return credential.controllerUrl;
        } catch (Exception ignored) {
            // Fall through to canonical Core address.
        }
        return CORE_URL;
    }

    private void writeNetworkProbe(boolean ok) {
        getSharedPreferences(SETUP_PREFS, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(KEY_NETWORK_OK, ok)
            .putLong(KEY_NETWORK_PROBE_AT, System.currentTimeMillis())
            .apply();
    }

    private void writeRuntimeStatus(String state, long heartbeatAt, String error) {
        getSharedPreferences(ForegroundWorkerService.PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(ForegroundWorkerService.KEY_CONTROLLER_STATE, state)
            .putLong(ForegroundWorkerService.KEY_LAST_HEARTBEAT_AT, heartbeatAt)
            .putString(ForegroundWorkerService.KEY_LAST_ERROR, error)
            .apply();
    }

    private long existingHeartbeat() {
        return getSharedPreferences(ForegroundWorkerService.PREFS, Context.MODE_PRIVATE)
            .getLong(ForegroundWorkerService.KEY_LAST_HEARTBEAT_AT, 0L);
    }

    private boolean hasCredential() {
        try {
            return new SecureCredentialStore(this).load() != null;
        } catch (Exception ignored) {
            return false;
        }
    }

    private boolean accessibilityEnabled() {
        ComponentName component = new ComponentName(this, AccessibilityBridgeService.class);
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        for (String service : enabled.split(":")) {
            if (service.equalsIgnoreCase(component.flattenToString())
                || service.equalsIgnoreCase(component.flattenToShortString())) return true;
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
        if (manager == null) return 0;
        return Math.max(0, Math.min(100, manager.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)));
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

    private void openChatGpt() {
        if (openInstalledPackage("com.openai.chatgpt")) return;
        Toast.makeText(this, "Chưa tìm thấy ứng dụng ChatGPT trên máy", Toast.LENGTH_LONG).show();
    }

    private void openGemini() {
        if (openInstalledPackage("com.google.android.apps.bard")) return;
        if (openInstalledPackage("com.google.android.googlequicksearchbox")) return;
        Toast.makeText(this, "Chưa tìm thấy ứng dụng Gemini trên máy", Toast.LENGTH_LONG).show();
    }

    private boolean openInstalledPackage(String packageName) {
        try {
            getPackageManager().getPackageInfo(packageName, 0);
            Intent launch = getPackageManager().getLaunchIntentForPackage(packageName);
            if (launch == null) return false;
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(launch);
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    private void openTailscale() {
        if (openInstalledPackage("com.tailscale.ipn")) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.tailscale.ipn")));
        } catch (Exception ignored) {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.tailscale.ipn")));
        }
    }

    private void startWorkerService() {
        Intent intent = new Intent(this, ForegroundWorkerService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
        else startService(intent);
    }

    private String friendlyCoreError(String message) {
        String lower = message.toLowerCase();
        if (lower.contains("failed to connect") || lower.contains("timeout") || lower.contains("unreachable")) {
            return "TigerIQ Core chưa phản hồi. Kiểm tra Tailscale/Core rồi thử lại.";
        }
        if (lower.contains("401")) return "Credential Worker chưa hợp lệ.";
        if (lower.contains("404")) return "Mobile API chưa khớp phiên bản Core.";
        return "Ghép chưa thành công: " + compact(message, 100);
    }

    private String safeError(Exception error) {
        String message = error.getMessage();
        if (message == null || message.trim().isEmpty()) message = error.getClass().getSimpleName();
        return compact(message, 160);
    }

    private String b1StateLabel(String state) {
        if ("WAITING_PROJECT".equals(state)) return "ĐANG TỰ VÀO PROJECT TIGERIQ AI LAB";
        if ("REQUESTED".equals(state)) return "ĐÃ XÁC NHẬN PROJECT · CHỜ NHẬP";
        if ("VERIFYING_CONTEXT".equals(state)) return "ĐANG TÌM Ô NHẬP";
        if ("INPUT_READY".equals(state)) return "ĐÃ ĐIỀN · CHỜ GỬI";
        if ("WAITING_AI".equals(state)) return "ĐÃ GỬI · ĐANG CHỜ AI";
        if ("COMPLETE".equals(state)) return "ĐẠT";
        if ("ERROR".equals(state)) return "LỖI";
        if ("CANCELLED".equals(state)) return "ĐÃ HỦY";
        return "CHƯA CHẠY";
    }

    private String friendlyPackage(String packageName) {
        if (packageName == null || packageName.isEmpty()) return "Chưa quan sát";
        if ("com.openai.chatgpt".equals(packageName)) return "ChatGPT";
        if ("com.google.android.apps.bard".equals(packageName)) return "Gemini";
        if ("com.google.android.googlequicksearchbox".equals(packageName)) return "Google/Gemini";
        if ("com.sec.android.app.launcher".equals(packageName)) return "Samsung Launcher";
        if (getPackageName().equals(packageName)) return "TigerIQ AI Worker";
        return packageName;
    }

    private String age(long timestamp) {
        if (timestamp <= 0) return "chưa có";
        long seconds = Math.max(0L, (System.currentTimeMillis() - timestamp) / 1000L);
        if (seconds < 60) return seconds + " giây trước";
        long minutes = seconds / 60;
        if (minutes < 60) return minutes + " phút trước";
        return (minutes / 60) + " giờ trước";
    }

    private String compact(String value, int max) {
        if (value == null) return "";
        String normalized = value.replace('\n', ' ').replace('\r', ' ').trim();
        return normalized.length() <= max ? normalized : normalized.substring(0, max) + "…";
    }

    private String shortNodeId() {
        String value = new NodeIdentityStore(this).getOrCreate();
        if (value.length() <= 18) return value;
        return value.substring(0, 10) + "…" + value.substring(value.length() - 6);
    }

    private String shortVersion() {
        String value = WorkerVersion.NAME;
        int dash = value.indexOf('-');
        return dash > 0 ? value.substring(0, dash) : value;
    }

    private LinearLayout card() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(14), dp(14), dp(14), dp(14));
        card.setBackground(panelBox(PANEL, LINE, 15));
        return card;
    }

    private LinearLayout horizontal() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        return row;
    }

    private TextView addKeyValue(LinearLayout parent, String key, String value) {
        LinearLayout row = horizontal();
        row.setGravity(Gravity.CENTER_VERTICAL);
        TextView keyView = text(key, 12, false);
        keyView.setTextColor(MUTED);
        row.addView(keyView, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.38f));
        TextView valueView = text(value, 13, true);
        valueView.setGravity(Gravity.END);
        row.addView(valueView, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 0.62f));
        parent.addView(row, marginParams(0, dp(3), 0, dp(3)));
        return valueView;
    }

    private TextView label(String value) {
        TextView view = text(value, 12, true);
        view.setTextColor(MUTED);
        return view;
    }

    private Button primaryButton(String label) {
        Button button = baseButton(label, CYAN, BG);
        return button;
    }

    private Button secondaryButton(String label) {
        return baseButton(label, PANEL_2, TEXT);
    }

    private Button baseButton(String label, int background, int foreground) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(foreground);
        button.setTextSize(12);
        button.setAllCaps(false);
        button.setTypeface(button.getTypeface(), Typeface.BOLD);
        button.setBackground(panelBox(background, LINE, 10));
        button.setPadding(dp(10), dp(8), dp(10), dp(8));
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        return button;
    }

    private TextView sectionTitle(String value) {
        TextView view = text(value, 15, true);
        view.setTextColor(TEXT);
        view.setPadding(dp(2), 0, 0, dp(4));
        return view;
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(TEXT);
        if (bold) view.setTypeface(view.getTypeface(), Typeface.BOLD);
        return view;
    }

    private GradientDrawable panelBox(int color, int strokeColor, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        drawable.setStroke(dp(1), strokeColor);
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

    private LinearLayout.LayoutParams weightedParams(float weight, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, weight);
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
