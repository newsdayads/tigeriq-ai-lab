package ai.tigeriq.worker.v07;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class V1AiSetupActivity extends Activity {
    private EditText modelInput;
    private EditText keyInput;
    private TextView statusView;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        setContentView(build());
    }

    private LinearLayout build() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 48, 48, 48);
        root.addView(text("AI của nhân viên này", 22));
        root.addView(text("Gemini API · khóa chỉ lưu mã hóa trên điện thoại bằng Android Keystore, không gửi về PC01.", 13));
        root.addView(text("ZERO-COST AUTHORITY: người dùng không thể tự xác nhận miễn phí. Gemini chỉ được thực thi khi có bằng chứng độc lập/enforceable rằng cấu hình không thể phát sinh phí.", 13));

        ProviderConfigStore config = new ProviderConfigStore(this);
        modelInput = new EditText(this);
        modelInput.setHint("Model Gemini");
        modelInput.setSingleLine(true);
        modelInput.setText(config.geminiModel());
        root.addView(modelInput);

        keyInput = new EditText(this);
        keyInput.setHint("Gemini API key · để trống nếu đã lưu");
        keyInput.setSingleLine(true);
        keyInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        keyInput.setSaveEnabled(false);
        root.addView(keyInput);

        Button save = new Button(this);
        save.setText("LƯU AI TRÊN MÁY");
        save.setAllCaps(false);
        save.setOnClickListener(v -> save());
        root.addView(save);

        statusView = text("GEMINI DIRECT: DISABLED · chưa có zero-cost authority độc lập/enforceable", 13);
        statusView.setTextColor(Color.rgb(185, 28, 28));
        root.addView(statusView);
        root.addView(text("Có thể lưu credential/model để chuẩn bị tích hợp, nhưng APP sẽ fail-closed và không gọi Gemini cho đến khi authority hợp lệ được triển khai. Không có paid fallback.", 12));
        return root;
    }

    private void save() {
        try {
            new ProviderConfigStore(this).saveGemini(keyInput.getText().toString(), modelInput.getText().toString());
            keyInput.setText("");
            statusView.setText("ĐÃ LƯU CẤU HÌNH · Gemini vẫn DISABLED vì chưa có zero-cost authority độc lập");
            statusView.setTextColor(Color.rgb(185, 28, 28));
            Toast.makeText(this, "Đã lưu AI trên điện thoại · chưa được phép thực thi", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            keyInput.setText("");
            statusView.setText("LỖI · " + error.getClass().getSimpleName());
            statusView.setTextColor(Color.rgb(185, 28, 28));
        }
    }

    private TextView text(String value, int sp) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(Color.rgb(22, 31, 46));
        view.setPadding(0, 12, 0, 12);
        return view;
    }
}
