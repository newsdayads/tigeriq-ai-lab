package ai.tigeriq.worker.v07;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class V07StatusActivity extends Activity {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private TextView stateView, messageView, jobView, pushView, evidenceView;
    private final Runnable refresh = new Runnable() { @Override public void run() { render(); handler.postDelayed(this, 1000L); } };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(48, 48, 48, 48);
        root.setGravity(Gravity.TOP);
        TextView title = text("TigerIQ AI · Worker v0.7 API-FIRST", 22);
        root.addView(title);
        stateView = text("NEED_ATTENTION", 28); root.addView(stateView);
        messageView = text("Đang kiểm tra trạng thái", 16); root.addView(messageView);
        jobView = text("", 14); root.addView(jobView);
        pushView = text("", 14); root.addView(pushView);
        evidenceView = text("", 12); root.addView(evidenceView);
        TextView safety = text("Thực thi qua TigerIQ API. Không dùng Accessibility làm execution engine.", 12); root.addView(safety);
        setContentView(root);
    }

    @Override protected void onResume() { super.onResume(); handler.removeCallbacks(refresh); handler.post(refresh); }
    @Override protected void onPause() { handler.removeCallbacks(refresh); super.onPause(); }

    private void render() {
        WorkerStatusStore.Snapshot s = new WorkerStatusStore(this).load();
        stateView.setText(s.state.name());
        stateView.setTextColor(s.state == WorkerState.READY ? Color.rgb(20,137,97) : s.state == WorkerState.WORKING ? Color.rgb(177,111,0) : Color.rgb(190,54,54));
        messageView.setText(s.message == null ? "" : s.message);
        jobView.setText(s.jobId == null || s.jobId.isBlank() ? "Không có job đang chạy" : "Job: " + s.jobId);
        pushView.setText("FCM: " + (s.pushState == null ? "UNKNOWN" : s.pushState));
        evidenceView.setText(s.lastEvidence == null || s.lastEvidence.isBlank() ? "Chưa có evidence gần nhất" : "Evidence: " + s.lastEvidence);
    }

    private TextView text(String value, int sp) { TextView v = new TextView(this); v.setText(value); v.setTextSize(sp); v.setTextColor(Color.rgb(22,31,46)); v.setPadding(0,12,0,12); return v; }
}
