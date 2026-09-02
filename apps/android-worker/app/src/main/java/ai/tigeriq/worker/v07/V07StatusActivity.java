package ai.tigeriq.worker.v07;

import android.app.Activity;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;

public final class V07StatusActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView stateView, messageView, jobView, pushView, aiView, evidenceView, identityView, contractView;
    private final Runnable refresh = new Runnable() { @Override public void run() { render(); handler.postDelayed(this, 1000L); } };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        V07WorkScheduler.ensurePeriodicRecovery(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 48, 48, 48);
        root.setGravity(Gravity.TOP);
        root.addView(text("TigerIQ AI · Nhân viên điện thoại V1", 22));
        contractView = text("Controller: " + ControllerV1Contract.PROTOCOL + " · PR #" + ControllerV1Contract.SOURCE_PR, 13); root.addView(contractView);
        stateView = text("NEED_ATTENTION", 28); root.addView(stateView);
        messageView = text("Đang kiểm tra trạng thái", 16); root.addView(messageView);
        identityView = text("Thiết bị: —", 12); root.addView(identityView);
        aiView = text("AI: chưa cấu hình", 14); root.addView(aiView);
        jobView = text("", 14); root.addView(jobView);
        pushView = text("", 14); root.addView(pushView);
        evidenceView = text("", 12); root.addView(evidenceView);

        Button copyIdentity = new Button(this);
        copyIdentity.setText("SAO CHÉP HỒ SƠ THIẾT BỊ CHO PC01");
        copyIdentity.setAllCaps(false);
        copyIdentity.setOnClickListener(v -> copyProvisioningProfile());
        root.addView(copyIdentity);

        Button aiSetup = new Button(this);
        aiSetup.setText("AI CỦA MÁY NÀY");
        aiSetup.setAllCaps(false);
        aiSetup.setOnClickListener(v -> startActivity(new Intent(this, V1AiSetupActivity.class)));
        root.addView(aiSetup);

        Button scanNow = new Button(this);
        scanNow.setText("LEASE JOB NGAY");
        scanNow.setAllCaps(false);
        scanNow.setOnClickListener(v -> {
            V07WorkScheduler.enqueueRecovery(this);
            new WorkerStatusStore(this).setState(WorkerState.WORKING, "Đã yêu cầu heartbeat + lease từ Controller V1", null);
        });
        root.addView(scanNow);
        root.addView(text("Chỉ dùng /api/v1/status + lease/result/heartbeat. Gemini chạy trực tiếp trên điện thoại. Không session Android, không Accessibility/UI automation.", 12));
        setContentView(root);
    }

    @Override protected void onResume() { super.onResume(); handler.removeCallbacks(refresh); handler.post(refresh); }
    @Override protected void onPause() { handler.removeCallbacks(refresh); super.onPause(); }

    private void render() {
        WorkerStatusStore.Snapshot s = new WorkerStatusStore(this).load();
        stateView.setText(s.state.name());
        stateView.setTextColor(s.state == WorkerState.READY ? Color.rgb(20,137,97) : s.state == WorkerState.WORKING ? Color.rgb(177,111,0) : Color.rgb(190,54,54));
        messageView.setText(s.message == null ? "" : s.message);
        jobView.setText(s.jobId == null || s.jobId.isBlank() ? "JOB: —" : "JOB: " + s.jobId);
        pushView.setText("Wake: " + (s.pushState == null ? "POLL_FALLBACK" : s.pushState));
        evidenceView.setText(s.lastEvidence == null || s.lastEvidence.isBlank() ? "Evidence: —" : "Evidence: " + s.lastEvidence);
        EmployeeDeviceStore.Profile profile = new EmployeeDeviceStore(this).load();
        if (profile == null) identityView.setText("Thiết bị: chưa activation");
        else identityView.setText("Employee: " + profile.employeeId + " · Device: " + profile.deviceId + " · Binding: " + (profile.bindingId.isBlank() ? "CHỜ PC01" : profile.bindingId));
        try {
            ProviderConfigStore config = new ProviderConfigStore(this);
            aiView.setText(config.hasGeminiKey() ? "AI: Gemini · " + config.geminiModel() + " · ĐÃ CẤU HÌNH" : "AI: Gemini · CHƯA CÓ API KEY");
        } catch (Exception error) {
            aiView.setText("AI: lỗi đọc credential cục bộ");
        }
    }

    private void copyProvisioningProfile() {
        EmployeeDeviceStore.Profile profile = new EmployeeDeviceStore(this).load();
        if (profile == null) { Toast.makeText(this, "Thiết bị chưa activation", Toast.LENGTH_SHORT).show(); return; }
        new Thread(() -> {
            try {
                DeviceKeyStore keys = new DeviceKeyStore(profile.employeeId, profile.deviceId);
                keys.ensureKey();
                JSONObject publicProfile = new JSONObject()
                        .put("protocol", ControllerV1Contract.PROTOCOL)
                        .put("controller", profile.controllerUrl)
                        .put("employeeId", profile.employeeId)
                        .put("nodeId", profile.nodeId)
                        .put("deviceId", profile.deviceId)
                        .put("publicKeyFingerprint", keys.publicKeyFingerprintSha256())
                        .put("publicKeyBase64", keys.publicKeyBase64());
                runOnUiThread(() -> {
                    ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    clipboard.setPrimaryClip(ClipData.newPlainText("TigerIQ Controller V1 device profile", publicProfile.toString()));
                    Toast.makeText(this, "Đã sao chép hồ sơ công khai · không có private key/API key", Toast.LENGTH_LONG).show();
                });
            } catch (Exception error) {
                runOnUiThread(() -> Toast.makeText(this, "Không đọc được hồ sơ thiết bị", Toast.LENGTH_SHORT).show());
            }
        }, "tigeriq-v1-public-profile").start();
    }

    private TextView text(String value, int sp) { TextView v = new TextView(this); v.setText(value); v.setTextSize(sp); v.setTextColor(Color.rgb(22,31,46)); v.setPadding(0,12,0,12); return v; }
}
