package ai.tigeriq.worker.v07;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.work.WorkManager;

/** TigerIQ V1 entry point: activate this Employee/Device against PC01; AI credentials are configured separately on-phone. */
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

        TextView title = text("TigerIQ AI · Nhân viên điện thoại V1", 23, true);
        title.setTextColor(NAVY); root.addView(title);
        TextView subtitle = text("PC01 giao JOB · điện thoại tự gọi AI · trả RESULT về PC01", 12, true);
        subtitle.setTextColor(ORANGE); root.addView(subtitle);
        TextView safety = text("Không Trợ năng · Không điều khiển màn hình. Khóa AI được cấu hình riêng và mã hóa trên chính điện thoại.", 13, false);
        safety.setTextColor(MUTED); safety.setPadding(0, dp(12), 0, dp(18)); root.addView(safety);

        checkButton = new Button(this);
        checkButton.setText("KIỂM TRA MÁY NÀY"); checkButton.setAllCaps(false); checkButton.setOnClickListener(v -> runDeviceCheck()); root.addView(checkButton);
        readinessView = text("Chưa kiểm tra phần cứng", 12, false); readinessView.setTextColor(MUTED); readinessView.setPadding(0, dp(8), 0, dp(18)); root.addView(readinessView);

        TextView activationTitle = text("Kết nối PC01 TigerIQ", 16, true); activationTitle.setTextColor(NAVY); root.addView(activationTitle);
        TextView activationHelp = text("Dán 1 mã kích hoạt do PC01/TigerIQ cấp. Mã chứa địa chỉ Tailscale, Employee và credential kích hoạt một lần.", 12, false);
        activationHelp.setTextColor(MUTED); activationHelp.setPadding(0, dp(6), 0, dp(8)); root.addView(activationHelp);

        activationInput = field("Mã kích hoạt TigerIQ · TIQ1.…");
        activationInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        activationInput.setSaveEnabled(false);
        activationInput.setImportantForAutofill(EditText.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        root.addView(activationInput);

        connectButton = new Button(this);
        connectButton.setText("KẾT NỐI PC01"); connectButton.setAllCaps(false); connectButton.setTextColor(Color.WHITE); connectButton.setBackgroundColor(ORANGE); connectButton.setOnClickListener(v -> connect()); root.addView(connectButton);
        statusView = text("Chưa kết nối PC01", 12, false); statusView.setTextColor(MUTED); statusView.setPadding(0, dp(10), 0, 0); root.addView(statusView);

        TextView footer = text("Sau khi activation, vào mục AI CỦA MÁY NÀY để lưu Gemini API key riêng. PC01 không nhận và không giữ khóa AI của điện thoại.", 11, false);
        footer.setTextColor(MUTED); footer.setPadding(0, dp(20), 0, 0); root.addView(footer);
        return root;
    }

    private void runDeviceCheck() {
        checkButton.setEnabled(false);
        readinessView.setText("Đang kiểm tra khóa bảo mật phần cứng và bộ lập lịch…");
        new Thread(() -> {
            try {
                DeviceKeyStore keyStore = new DeviceKeyStore("SELFTEST-EMP", "SELFTEST-DEVICE");
                keyStore.ensureKey();
                if (!keyStore.isHardwareBacked()) throw new DeviceKeyStore.HardwareBackingUnavailableException();
                String fingerprint = keyStore.publicKeyFingerprintSha256();
                WorkManager.getInstance(this);
                runOnUiThread(() -> { readinessView.setText("ĐẠT · Khóa phần cứng + WorkManager sẵn sàng · " + fingerprint.substring(0, 12)); readinessView.setTextColor(Color.rgb(22, 101, 52)); checkButton.setEnabled(true); });
            } catch (Exception error) {
                runOnUiThread(() -> { readinessView.setText("LỖI · " + safeError(error)); readinessView.setTextColor(Color.rgb(185, 28, 28)); checkButton.setEnabled(true); });
            }
        }, "tigeriq-v1-device-check").start();
    }

    private void connect() {
        ActivationCode.Bundle activation;
        try { activation = ActivationCode.parse(activationInput.getText().toString()); }
        catch (Exception error) { Toast.makeText(this, "Mã kích hoạt không hợp lệ", Toast.LENGTH_SHORT).show(); statusView.setText("Kết nối thất bại · mã kích hoạt không hợp lệ"); return; }
        activationInput.setText("");
        connectButton.setEnabled(false);
        statusView.setText("Đang xác minh thiết bị với PC01…");
        new Thread(() -> {
            try {
                new EnrollmentCoordinator(this).enroll(activation.controller, activation.employeeId, activation.credentialId, activation.bootstrapToken);
                V07WorkScheduler.ensurePeriodicRecovery(this);
                V07WorkScheduler.enqueueRecovery(this);
                new WorkerStatusStore(this).setPushState("PUSH_OR_POLL_READY");
                runOnUiThread(() -> { statusView.setText("Kết nối PC01 thành công"); openStatus(); });
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
