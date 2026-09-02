package ai.tigeriq.worker.v07;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.work.WorkManager;

/** TigerIQ V1 entry: create phone identity and verify the canonical Controller before PC01 provisions the binding. */
public final class V07EnrollmentActivity extends Activity {
    private static final int NAVY = Color.rgb(17, 24, 39);
    private static final int ORANGE = Color.rgb(244, 113, 31);
    private static final int MUTED = Color.rgb(92, 105, 125);

    private EditText activationInput;
    private Button connectButton;
    private Button checkButton;
    private TextView readinessView;
    private TextView statusView;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (new EmployeeDeviceStore(this).isEnrolled()) {
            V07WorkScheduler.ensurePeriodicRecovery(this);
            openStatus();
            return;
        }
        setContentView(buildScreen());
    }

    private LinearLayout buildScreen() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(22), dp(26), dp(22), dp(26));
        root.setBackgroundColor(Color.rgb(246, 247, 251));

        TextView title = text("TigerIQ AI Lab · Android Worker V1", 23, true);
        title.setTextColor(NAVY); root.addView(title);
        TextView subtitle = text("Controller V1 · nhận JOB từ PC01 · trả RESULT + evidence", 12, true);
        subtitle.setTextColor(ORANGE); root.addView(subtitle);
        TextView safety = text("Gemini direct: DISABLED theo policy 0đ. Không Accessibility/UI automation; preflight không gọi provider.", 13, false);
        safety.setTextColor(MUTED); safety.setPadding(0, dp(12), 0, dp(18)); root.addView(safety);

        checkButton = new Button(this);
        checkButton.setText("KIỂM TRA MÁY NÀY"); checkButton.setAllCaps(false); checkButton.setOnClickListener(v -> runDeviceCheck()); root.addView(checkButton);
        readinessView = text("Chưa kiểm tra phần cứng", 12, false); readinessView.setTextColor(MUTED); readinessView.setPadding(0, dp(8), 0, dp(18)); root.addView(readinessView);

        TextView activationTitle = text("Kết nối Controller V1 trên PC01", 16, true); activationTitle.setTextColor(NAVY); root.addView(activationTitle);
        TextView activationHelp = text("Dán mã TIQ1 chứa Controller + Employee ID. APP chỉ nhận endpoint đúng PR #116; URL sai sẽ fail-closed.", 12, false);
        activationHelp.setTextColor(MUTED); activationHelp.setPadding(0, dp(6), 0, dp(8)); root.addView(activationHelp);

        activationInput = field("Mã TigerIQ V1 · TIQ1.…");
        activationInput.setSaveEnabled(false);
        activationInput.setImportantForAutofill(EditText.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        root.addView(activationInput);

        connectButton = new Button(this);
        connectButton.setText("TẠO DANH TÍNH & KIỂM TRA CONTROLLER"); connectButton.setAllCaps(false); connectButton.setTextColor(Color.WHITE); connectButton.setBackgroundColor(ORANGE); connectButton.setOnClickListener(v -> connect()); root.addView(connectButton);
        statusView = text("Chưa kết nối Controller V1", 12, false); statusView.setTextColor(MUTED); statusView.setPadding(0, dp(10), 0, 0); root.addView(statusView);

        TextView footer = text("Private key Android Keystore không rời điện thoại. Pairing/JOB-001 chỉ chạy sau PC01_PHYSICAL_GO_LIVE_PASS.", 11, false);
        footer.setTextColor(MUTED); footer.setPadding(0, dp(20), 0, 0); root.addView(footer);
        return root;
    }

    private void runDeviceCheck() {
        checkButton.setEnabled(false);
        readinessView.setText("Đang kiểm tra Android Keystore phần cứng và WorkManager…");
        new Thread(() -> {
            try {
                DeviceKeyStore keyStore = new DeviceKeyStore("SELFTEST-EMP", "SELFTEST-DEVICE");
                keyStore.ensureKey();
                if (!keyStore.isHardwareBacked()) throw new DeviceKeyStore.HardwareBackingUnavailableException();
                String fingerprint = keyStore.publicKeyFingerprintSha256();
                WorkManager.getInstance(this);
                runOnUiThread(() -> { readinessView.setText("ĐẠT · Keystore + WorkManager · " + fingerprint.substring(0, 12)); readinessView.setTextColor(Color.rgb(22, 101, 52)); checkButton.setEnabled(true); });
            } catch (Exception error) {
                runOnUiThread(() -> { readinessView.setText("LỖI · " + safeError(error)); readinessView.setTextColor(Color.rgb(185, 28, 28)); checkButton.setEnabled(true); });
            }
        }, "tigeriq-v1-device-check").start();
    }

    private void connect() {
        ActivationCode.Bundle activation;
        try { activation = ActivationCode.parse(activationInput.getText().toString()); }
        catch (Exception error) { Toast.makeText(this, "Mã V1/endpoint không hợp lệ", Toast.LENGTH_SHORT).show(); statusView.setText("Kết nối thất bại · mã/endpoint không hợp lệ"); return; }
        connectButton.setEnabled(false);
        statusView.setText("Đang tạo danh tính Keystore và kiểm tra /api/v1/status…");
        new Thread(() -> {
            try {
                new EnrollmentCoordinator(this).enroll(activation.controller, activation.employeeId);
                V07WorkScheduler.ensurePeriodicRecovery(this);
                new WorkerStatusStore(this).setPushState("POLL_FALLBACK_READY");
                runOnUiThread(() -> { activationInput.setText(""); statusView.setText("Controller V1 tương thích · cần provision thiết bị trên PC01"); openStatus(); });
            } catch (Exception error) {
                runOnUiThread(() -> { connectButton.setEnabled(true); statusView.setText("Kết nối thất bại · " + safeError(error)); });
            }
        }, "tigeriq-v1-enrollment").start();
    }

    private void openStatus() { startActivity(new Intent(this, V07StatusActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)); finish(); }
    private EditText field(String hint) { EditText input = new EditText(this); input.setHint(hint); input.setTextSize(14); input.setSingleLine(true); input.setSaveEnabled(false); input.setPadding(dp(12), dp(10), dp(12), dp(10)); LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT); params.setMargins(0, 0, 0, dp(10)); input.setLayoutParams(params); return input; }
    private TextView text(String value, int sp, boolean bold) { TextView view = new TextView(this); view.setText(value); view.setTextSize(sp); view.setGravity(Gravity.START); if (bold) view.setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD); return view; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private static String safeError(Exception error) { if (error instanceof ApiException api) return api.code; if (error instanceof DeviceKeyStore.HardwareBackingUnavailableException) return "SECURE_HARDWARE_UNAVAILABLE"; return error.getClass().getSimpleName(); }
}
