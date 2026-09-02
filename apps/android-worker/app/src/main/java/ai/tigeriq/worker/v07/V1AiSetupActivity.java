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
        root.addView(text("TigerIQ AI Lab · AI của Worker", 22));
        root.addView(text("Gemini direct hiện bị khóa theo luật 0đ. APP không gọi provider và không có paid fallback.", 13));
        root.addView(text("ZERO-COST AUTHORITY phải là bằng chứng độc lập/enforceable; local state, checkbox hoặc lời xác nhận của người dùng không có quyền mở thực thi.", 13));

        ProviderConfigStore config = new ProviderConfigStore(this);
        modelInput = new EditText(this);
        modelInput.setHint("Model Gemini");
        modelInput.setSingleLine(true);
        modelInput.setText(config.geminiModel());
        modelInput.setEnabled(false);
        root.addView(modelInput);

        keyInput = new EditText(this);
        keyInput.setHint("Gemini API key · khóa nhập trong preflight");
        keyInput.setSingleLine(true);
        keyInput.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        keyInput.setSaveEnabled(false);
        keyInput.setEnabled(false);
        root.addView(keyInput);

        Button save = new Button(this);
        save.setText("GEMINI DIRECT · DISABLED");
        save.setAllCaps(false);
        save.setEnabled(false);
        root.addView(save);

        statusView = text("GEMINI DIRECT: DISABLED · " + config.zeroCostAuthority().reason(), 13);
        statusView.setTextColor(Color.rgb(185, 28, 28));
        root.addView(statusView);
        root.addView(text("Màn hình này chỉ hiển thị trạng thái policy. Không nhập/lưu credential mới trong preflight Issue #160.", 12));
        return root;
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
