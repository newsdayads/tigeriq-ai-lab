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

/**
 * Secure v0.7 entry point.
 * Normal operation uses one TigerIQ activation code; technical gateway/credential fields are not exposed to the owner.
 */
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
        // Enrollment material must never be captured in screenshots, recents thumbnails or screen sharing.
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

        TextView title = text("TigerIQ AI · Nhân viên v0.7.1", 23, true);
        title.setTextColor(NAVY);
        root.addView(title);

        TextView subtitle = text("Mở APP → kiểm tra máy → kết nối bằng 1 mã", 12, true);
        subtitle.setTextColor(ORANGE);
        root.addView(subtitle);

        TextView safety = text("Không Trợ năng · Không điều khiển màn hình · Không chứa API key Gemini/Groq/OpenRouter.", 13, false);
        safety.setTextColor(MUTED);
        safety.setPadding(0, dp(12), 0, dp(18));
        root.addView(safety);

        checkButton = new Button(this);
        checkButton.setText("KIỂM TRA MÁY NÀY");
        checkButton.setAllCaps(false);
        checkButton.setOnClickListener(v -> runDeviceCheck());
        root.addView(checkButton);

        readinessView = text("Chưa kiểm tra phần cứng", 12, false);
        readinessView.setTextColor(MUTED);
        readinessView.setPadding(0, dp(8), 0, dp(18));
        root.addView(readinessView);

        TextView activationTitle = text("Kết nối TigerIQ", 16, true);
        activationTitle.setTextColor(NAVY);
        root.addView(activationTitle);

        TextView activationHelp = text("Dán 1 mã kích hoạt do TigerIQ cấp. APP tự lấy Gateway, Employee và Credential từ mã này.", 12, false);
        activationHelp.setTextColor(MUTED);
        activationHelp.setPadding(0, dp(6), 0, dp(8));
        root.addView(activationHelp);

        activationInput = field("Mã kích hoạt TigerIQ · TIQ1.…");
        activationInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        activationInput.setSaveEnabled(false);
        activationInput.setImportantForAutofill(EditText.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        root.addView(activationInput);

        connectButton = new Button(this);
        connectButton.setText("KẾT NỐI TIGERIQ");
        connectButton.setAllCaps(false);
        connectButton.setTextColor(Color.WHITE);
        connectButton.setBackgroundColor(ORANGE);
        connectButton.setOnClickListener(v -> connect());
        root.addView(connectButton);

        statusView = text("Chưa kết nối hệ thống", 12, false);
        statusView.setTextColor(MUTED);
        statusView.setPadding(0, dp(10), 0, 0);
        root.addView(statusView);

        TextView footer = text("Nếu chưa có mã kích hoạt, nút KIỂM TRA MÁY NÀY vẫn xác minh được khóa bảo mật phần cứng và WorkManager trên chính điện thoại này.", 11, false);
        footer.setTextColor(MUTED);
        footer.setPadding(0, dp(20), 0, 0);
        root.addView(footer);
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
                runOnUiThread(() -> {
                    readinessView.setText("ĐẠT · Khóa phần cứng + WorkManager sẵn sàng · " + fingerprint.substring(0, 12));
                    readinessView.setTextColor(Color.rgb(22, 101, 52));
                    checkButton.setEnabled(true);
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    readinessView.setText("LỖI · " + safeError(error));
                    readinessView.setTextColor(Color.rgb(185, 28, 28));
                    checkButton.setEnabled(true);
                });
            }
        }, "tigeriq-v07-device-check").start();
    }

    private void connect() {
        ActivationCode.Bundle activation;
        try {
            activation = ActivationCode.parse(activationInput.getText().toString());
        } catch (Exception error) {
            Toast.makeText(this, "Mã kích hoạt không hợp lệ", Toast.LENGTH_SHORT).show();
            statusView.setText("Kết nối thất bại · mã kích hoạt không hợp lệ");
            return;
        }

        // Remove one-time material from UI state before network enrollment begins.
        activationInput.setText("");
        connectButton.setEnabled(false);
        statusView.setText("Đang xác minh thiết bị và tạo khóa phần cứng…");

        new Thread(() -> {
            try {
                new EnrollmentCoordinator(this).enroll(
                        activation.gateway,
                        activation.employeeId,
                        activation.credentialId,
                        activation.bootstrapToken);
                V07WorkScheduler.ensurePeriodicRecovery(this);
                V07WorkScheduler.enqueueRecovery(this);
                new WorkerStatusStore(this).setPushState("PUSH_OR_POLL_READY");
                runOnUiThread(() -> {
                    statusView.setText("Kết nối thành công");
                    openStatus();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    connectButton.setEnabled(true);
                    statusView.setText("Kết nối thất bại · " + safeError(error));
                });
            }
        }, "tigeriq-v07-enrollment").start();
    }

    private void openStatus() {
        startActivity(new Intent(this, V07StatusActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
        finish();
    }

    private EditText field(String hint) {
        EditText input = new EditText(this);
        input.setHint(hint);
        input.setTextSize(14);
        input.setSingleLine(true);
        input.setSaveEnabled(false);
        input.setPadding(dp(12), dp(10), dp(12), dp(10));
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(0, 0, 0, dp(10));
        input.setLayoutParams(params);
        return input;
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setGravity(Gravity.START);
        if (bold) view.setTypeface(android.graphics.Typeface.DEFAULT, android.graphics.Typeface.BOLD);
        return view;
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private static String safeError(Exception error) {
        if (error instanceof ApiException api) return api.code;
        if (error instanceof DeviceKeyStore.HardwareBackingUnavailableException) return "SECURE_HARDWARE_UNAVAILABLE";
        return error.getClass().getSimpleName();
    }
}
