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

/**
 * Secure v0.7 entry point. This screen performs TigerIQ Employee/Device enrollment only.
 * It never asks for Accessibility, never opens another AI app, and never stores provider credentials.
 */
public final class V07EnrollmentActivity extends Activity {
    private static final int NAVY = Color.rgb(17, 24, 39);
    private static final int ORANGE = Color.rgb(244, 113, 31);
    private static final int MUTED = Color.rgb(92, 105, 125);

    private EditText gatewayInput;
    private EditText employeeInput;
    private EditText credentialInput;
    private EditText bootstrapInput;
    private Button enrollButton;
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

        TextView title = text("TigerIQ AI · Nhân viên v0.7", 23, true);
        title.setTextColor(NAVY);
        root.addView(title);
        TextView subtitle = text("API-FIRST · Không Accessibility · Không điều khiển màn hình", 12, true);
        subtitle.setTextColor(ORANGE);
        root.addView(subtitle);

        TextView safety = text("Chỉ đăng ký danh tính Employee/Device với TigerIQ. API key của Gemini/Groq/OpenRouter không bao giờ nằm trong APP.", 13, false);
        safety.setTextColor(MUTED);
        safety.setPadding(0, dp(12), 0, dp(18));
        root.addView(safety);

        gatewayInput = field("TigerIQ Gateway HTTPS, ví dụ https://...");
        employeeInput = field("Employee ID, ví dụ EMP-001");
        credentialInput = field("Credential ID do TigerIQ cấp");
        bootstrapInput = field("Mã enrollment một lần");
        bootstrapInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        bootstrapInput.setSaveEnabled(false);
        bootstrapInput.setImportantForAutofill(EditText.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);

        root.addView(gatewayInput);
        root.addView(employeeInput);
        root.addView(credentialInput);
        root.addView(bootstrapInput);

        enrollButton = new Button(this);
        enrollButton.setText("ĐĂNG KÝ THIẾT BỊ");
        enrollButton.setAllCaps(false);
        enrollButton.setTextColor(Color.WHITE);
        enrollButton.setBackgroundColor(ORANGE);
        enrollButton.setOnClickListener(v -> enroll());
        root.addView(enrollButton);

        statusView = text("Chưa đăng ký", 12, false);
        statusView.setTextColor(MUTED);
        statusView.setPadding(0, dp(10), 0, 0);
        root.addView(statusView);

        TextView footer = text("Bản v0.7 không yêu cầu quyền Trợ năng, không đọc ứng dụng ngân hàng, không dùng overlay và không mở Gemini để thực thi.", 11, false);
        footer.setTextColor(MUTED);
        footer.setPadding(0, dp(20), 0, 0);
        root.addView(footer);
        return root;
    }

    private void enroll() {
        String gateway = gatewayInput.getText().toString().trim();
        String employee = employeeInput.getText().toString().trim();
        String credential = credentialInput.getText().toString().trim();
        String bootstrap = bootstrapInput.getText().toString();
        if (gateway.isEmpty() || employee.isEmpty() || credential.isEmpty() || bootstrap.isEmpty()) {
            Toast.makeText(this, "Điền đủ thông tin enrollment", Toast.LENGTH_SHORT).show();
            return;
        }
        enrollButton.setEnabled(false);
        statusView.setText("Đang xác minh thiết bị và tạo khóa phần cứng…");

        new Thread(() -> {
            try {
                new EnrollmentCoordinator(this).enroll(gateway, employee, credential, bootstrap);
                // Minimize lifetime of one-time enrollment material in Java/UI state.
                bootstrapInput.post(() -> bootstrapInput.setText(""));
                V07WorkScheduler.ensurePeriodicRecovery(this);
                V07WorkScheduler.enqueueRecovery(this);
                new WorkerStatusStore(this).setPushState("PUSH_OR_POLL_READY");
                runOnUiThread(() -> {
                    statusView.setText("Đăng ký thành công");
                    openStatus();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    bootstrapInput.setText("");
                    enrollButton.setEnabled(true);
                    statusView.setText("Đăng ký thất bại · " + safeError(error));
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
        return error.getClass().getSimpleName();
    }
}
