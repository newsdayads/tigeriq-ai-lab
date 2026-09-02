package ai.tigeriq.worker.v07;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class V07StatusActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView stateView, messageView, jobView, pushView, aiView, evidenceView;
    private final Runnable refresh = new Runnable() { @Override public void run() { render(); handler.postDelayed(this, 1000L); } };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        V07WorkScheduler.ensurePeriodicRecovery(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 48, 48, 48);
        root.setGravity(Gravity.TOP);
        root.addView(text("TigerIQ AI · Nhân viên điện thoại V1", 22));
        stateView = text("NEED_ATTENTION", 28); root.addView(stateView);
        messageView = text("Đang kiểm tra trạng thái", 16); root.addView(messageView);
        aiView = text("AI: chưa cấu hình", 14); root.addView(aiView);
        jobView = text("", 14); root.addView(jobView);
        pushView = text("", 14); root.addView(pushView);
        evidenceView = text("", 12); root.addView(evidenceView);

        Button aiSetup = new Button(this);
        aiSetup.setText("AI CỦA MÁY NÀY");
        aiSetup.setAllCaps(false);
        aiSetup.setOnClickListener(v -> startActivity(new Intent(this, V1AiSetupActivity.class)));
        root.addView(aiSetup);

        Button scanNow = new Button(this);
        scanNow.setText("QUÉT JOB NGAY");
        scanNow.setAllCaps(false);
        scanNow.setOnClickListener(v -> {
            V07WorkScheduler.enqueueRecovery(this);
            new WorkerStatusStore(this).setState(WorkerState.WORKING, "Đã yêu cầu quét JOB từ PC01", null);
        });
        root.addView(scanNow);
        root.addView(text("PC01 chỉ giao JOB/nhận RESULT. AI chạy trực tiếp từ điện thoại bằng credential riêng của máy. Accessibility/UI automation đang đóng băng.", 12));
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
        try {
            ProviderConfigStore config = new ProviderConfigStore(this);
            aiView.setText(config.hasGeminiKey() ? "AI: Gemini · " + config.geminiModel() + " · ĐÃ CẤU HÌNH" : "AI: Gemini · CHƯA CÓ API KEY");
        } catch (Exception error) {
            aiView.setText("AI: lỗi đọc credential cục bộ");
        }
    }

    private TextView text(String value, int sp) { TextView v = new TextView(this); v.setText(value); v.setTextSize(sp); v.setTextColor(Color.rgb(22,31,46)); v.setPadding(0,12,0,12); return v; }
}
