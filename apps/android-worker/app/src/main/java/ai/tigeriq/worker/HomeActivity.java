package ai.tigeriq.worker;

import android.Manifest;
import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

/** Primary phone-first work surface shown after one-time setup. */
public final class HomeActivity extends Activity {
    private static final String GEMINI_PACKAGE = "com.google.android.apps.bard";
    private static final int NAVY = Color.rgb(17, 24, 39);
    private static final int ORANGE = Color.rgb(244, 113, 31);
    private static final int GOLD = Color.rgb(250, 190, 58);
    private static final int INK = Color.rgb(22, 31, 46);
    private static final int MUTED = Color.rgb(92, 105, 125);
    private static final int SURFACE = Color.rgb(246, 247, 251);
    private static final int GREEN = Color.rgb(20, 137, 97);
    private static final int RED = Color.rgb(190, 54, 54);
    private static final int AMBER = Color.rgb(177, 111, 0);

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean resumed;
    private TextView readinessTitle;
    private TextView readinessCopy;
    private EditText taskInput;
    private Button taskButton;
    private TextView taskState;
    private TextView resultView;
    private TextView timingView;

    private final Runnable refreshLoop = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            refreshUi();
            handler.postDelayed(this, 1000L);
        }
    };

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (!SetupStateStore.completed(this) || !localReady()) {
            openSetup(false);
            return;
        }
        setContentView(buildScreen());
        startWorkerService();
        refreshUi();
    }

    @Override protected void onResume() {
        super.onResume();
        resumed = true;
        handler.removeCallbacks(refreshLoop);
        handler.post(refreshLoop);
    }

    @Override protected void onPause() {
        resumed = false;
        handler.removeCallbacks(refreshLoop);
        super.onPause();
    }

    private View buildScreen() {
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setBackgroundColor(SURFACE);
        shell.addView(brandHeader());

        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(34));
        scroll.addView(root);
        shell.addView(scroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout readyCard = card();
        readinessTitle = text("ĐANG KIỂM TRA", 21, true);
        readinessCopy = text("TigerIQ đang kiểm tra điện thoại.", 13, false);
        readyCard.addView(readinessTitle);
        readyCard.addView(readinessCopy, margin(0, dp(6), 0, 0));
        root.addView(readyCard);

        TextView taskTitle = text("Giao việc cho nhân viên AI", 19, true);
        root.addView(taskTitle, margin(0, dp(22), 0, dp(8)));

        LinearLayout taskCard = card();
        TextView taskHint = text("Nhập yêu cầu. TigerIQ sẽ tự mở Gemini, nhập nội dung, bấm gửi, chờ trả lời và đưa kết quả về đây.", 13, false);
        taskHint.setTextColor(MUTED);
        taskCard.addView(taskHint);

        taskInput = new EditText(this);
        taskInput.setHint("Ví dụ: Tìm 5 công cụ AI miễn phí phù hợp cho nhóm bán hàng và so sánh ưu nhược điểm.");
        taskInput.setTextSize(15);
        taskInput.setTextColor(INK);
        taskInput.setHintTextColor(Color.rgb(135, 145, 160));
        taskInput.setMinLines(4);
        taskInput.setGravity(Gravity.TOP | Gravity.START);
        taskInput.setPadding(dp(14), dp(12), dp(14), dp(12));
        taskInput.setBackground(roundRect(Color.rgb(242, 244, 248), 14));
        taskCard.addView(taskInput, margin(0, dp(12), 0, dp(10)));

        taskButton = primaryButton("GIAO VIỆC");
        taskButton.setOnClickListener(v -> submitTask());
        taskCard.addView(taskButton);

        taskState = text("Chưa có công việc đang chạy.", 13, true);
        taskCard.addView(taskState, margin(0, dp(12), 0, 0));
        timingView = text("", 11, false);
        timingView.setTextColor(MUTED);
        taskCard.addView(timingView, margin(0, dp(4), 0, 0));
        root.addView(taskCard);

        TextView resultTitle = text("Kết quả gần nhất", 19, true);
        root.addView(resultTitle, margin(0, dp(22), 0, dp(8)));
        LinearLayout resultCard = card();
        resultView = text("Chưa có kết quả.", 14, false);
        resultView.setTextColor(MUTED);
        resultCard.addView(resultView);
        Button inspectGemini = secondaryButton("MỞ GEMINI KIỂM TRA");
        inspectGemini.setOnClickListener(v -> openGemini());
        resultCard.addView(inspectGemini, margin(0, dp(12), 0, 0));
        root.addView(resultCard);

        Button setup = secondaryButton("THIẾT LẬP & QUYỀN");
        setup.setOnClickListener(v -> openSetup(true));
        root.addView(setup, margin(0, dp(20), 0, 0));

        TextView footer = text("PHONE-FIRST · PC01/Tailscale không bắt buộc. TigerIQ chỉ đọc phần giao diện Gemini cần thiết cho công việc đang chạy.", 11, false);
        footer.setTextColor(MUTED);
        root.addView(footer, margin(0, dp(10), 0, 0));
        return shell;
    }

    private View brandHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(18), dp(14), dp(18), dp(14));
        header.setBackgroundColor(NAVY);
        TextView mark = text("TI", 18, true);
        mark.setGravity(Gravity.CENTER);
        mark.setTextColor(NAVY);
        mark.setBackground(roundRect(GOLD, 18));
        header.addView(mark, fixed(dp(44), dp(44), dp(12)));
        LinearLayout brand = new LinearLayout(this);
        brand.setOrientation(LinearLayout.VERTICAL);
        TextView name = text("TigerIQ AI", 21, true);
        name.setTextColor(Color.WHITE);
        brand.addView(name);
        TextView subtitle = text("NHÂN VIÊN AI · GEMINI", 11, true);
        subtitle.setTextColor(GOLD);
        brand.addView(subtitle);
        header.addView(brand, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        TextView mode = text("LOCAL", 10, true);
        mode.setTextColor(Color.WHITE);
        mode.setGravity(Gravity.CENTER);
        mode.setPadding(dp(10), dp(6), dp(10), dp(6));
        mode.setBackground(roundRect(ORANGE, 18));
        header.addView(mode);
        return header;
    }

    private void refreshUi() {
        boolean ready = localReady();
        LocalTaskStore.Snapshot task = LocalTaskStore.load(this);
        boolean working = task.active();

        if (!ready) {
            readinessTitle.setText("CẦN KIỂM TRA QUYỀN");
            readinessTitle.setTextColor(RED);
            readinessCopy.setText("Một quyền cần thiết đã bị tắt. Bấm THIẾT LẬP & QUYỀN để khôi phục.");
        } else if (working) {
            readinessTitle.setText("ĐANG LÀM VIỆC");
            readinessTitle.setTextColor(AMBER);
            readinessCopy.setText("TigerIQ đang điều khiển Gemini cho công việc hiện tại.");
        } else {
            readinessTitle.setText("SẴN SÀNG");
            readinessTitle.setTextColor(GREEN);
            readinessCopy.setText("Điện thoại đã sẵn sàng. Nhập việc và bấm GIAO VIỆC.");
        }

        taskButton.setEnabled(ready && !working);
        taskButton.setAlpha(taskButton.isEnabled() ? 1f : 0.45f);
        taskInput.setEnabled(!working);
        taskState.setText(taskStateText(task));
        taskState.setTextColor(LocalTaskStore.FAILED.equals(task.state) ? RED : (LocalTaskStore.RESULT_READY.equals(task.state) ? GREEN : MUTED));
        timingView.setText(taskTiming(task));

        if (LocalTaskStore.RESULT_READY.equals(task.state) && !task.result.isEmpty()) {
            resultView.setText(task.result);
            resultView.setTextColor(INK);
        } else if (LocalTaskStore.FAILED.equals(task.state)) {
            resultView.setText("TigerIQ dừng an toàn: " + friendlyError(task.error));
            resultView.setTextColor(RED);
        } else if (working) {
            resultView.setText("Đang chờ Gemini hoàn tất…");
            resultView.setTextColor(MUTED);
        } else {
            resultView.setText("Chưa có kết quả.");
            resultView.setTextColor(MUTED);
        }
    }

    private void submitTask() {
        if (!localReady()) {
            openSetup(false);
            return;
        }
        String prompt = taskInput.getText().toString().trim();
        if (prompt.length() < 4) {
            Toast.makeText(this, "Nhập nội dung công việc trước", Toast.LENGTH_SHORT).show();
            return;
        }
        LocalTaskStore.queue(this, prompt);
        if (!openGemini()) {
            LocalTaskStore.fail(this, "APP_NOT_INSTALLED");
            Toast.makeText(this, "Không mở được Gemini", Toast.LENGTH_LONG).show();
        } else {
            Toast.makeText(this, "Đã giao việc · TigerIQ đang tự thực hiện", Toast.LENGTH_SHORT).show();
        }
        refreshUi();
    }

    private String taskStateText(LocalTaskStore.Snapshot task) {
        if (LocalTaskStore.QUEUED.equals(task.state)) return "1/3 · Đang tìm ô nhập và chuẩn bị yêu cầu…";
        if (LocalTaskStore.INPUT_SET.equals(task.state)) return "2/3 · Đã nhập yêu cầu · đang bấm Gửi…";
        if (LocalTaskStore.SUBMITTED.equals(task.state)) return "3/3 · Đã gửi · đang chờ Gemini trả lời…";
        if (LocalTaskStore.RESULT_READY.equals(task.state)) return "HOÀN TẤT · Đã lấy được kết quả";
        if (LocalTaskStore.FAILED.equals(task.state)) return "CẦN KIỂM TRA · " + friendlyError(task.error);
        return "Chưa có công việc đang chạy.";
    }

    private String taskTiming(LocalTaskStore.Snapshot task) {
        if (task.startedAt <= 0L) return "";
        long end = task.active() ? System.currentTimeMillis() : task.updatedAt;
        long seconds = Math.max(0L, (end - task.startedAt) / 1000L);
        return "Thời gian: " + seconds + " giây";
    }

    private String friendlyError(String error) {
        if (error == null) return "Không xác định";
        switch (error) {
            case "TIMEOUT": return "Gemini không hoàn tất trong thời gian cho phép";
            case "ACCESSIBILITY_DISABLED": return "Quyền điều khiển đã bị tắt";
            case "APP_NOT_INSTALLED": return "Chưa cài Gemini";
            case "LOGIN_REQUIRED": return "Gemini yêu cầu đăng nhập";
            case "UI_CHANGED": return "TigerIQ chưa nhận diện được giao diện Gemini hiện tại";
            case "PROVIDER_LIMIT": return "Gemini đang giới hạn sử dụng hoặc yêu cầu thử lại sau";
            default: return error;
        }
    }

    private boolean localReady() {
        return notificationGranted() && accessibilityEnabled() && batteryUnrestricted()
            && geminiInstalled() && SetupStateStore.geminiConfirmed(this);
    }

    private boolean notificationGranted() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean accessibilityEnabled() {
        ComponentName expected = new ComponentName(this, AccessibilityBridgeService.class);
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        for (String entry : enabled.split(":")) {
            ComponentName value = ComponentName.unflattenFromString(entry);
            if (expected.equals(value)) return true;
        }
        return false;
    }

    private boolean batteryUnrestricted() {
        PowerManager manager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        return manager != null && manager.isIgnoringBatteryOptimizations(getPackageName());
    }

    private boolean geminiInstalled() {
        return getPackageManager().getLaunchIntentForPackage(GEMINI_PACKAGE) != null;
    }

    private boolean openGemini() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(GEMINI_PACKAGE);
        if (launch == null) return false;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(launch);
        return true;
    }

    private void openSetup(boolean force) {
        Intent intent = new Intent(this, PermissionWizardActivity.class);
        intent.putExtra(PermissionWizardActivity.EXTRA_FORCE_SETUP, force);
        startActivity(intent);
        finish();
    }

    private void startWorkerService() {
        Intent service = new Intent(this, ForegroundWorkerService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(INK);
        view.setLineSpacing(0f, 1.08f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private LinearLayout card() {
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(dp(16), dp(16), dp(16), dp(16));
        layout.setBackground(roundRect(Color.WHITE, 18));
        layout.setElevation(dp(1));
        return layout;
    }

    private Button primaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(14);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setAllCaps(false);
        button.setPadding(dp(14), dp(12), dp(14), dp(12));
        button.setBackground(roundRect(ORANGE, 14));
        return button;
    }

    private Button secondaryButton(String label) {
        Button button = new Button(this);
        button.setText(label);
        button.setTextColor(INK);
        button.setTextSize(12);
        button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setAllCaps(false);
        button.setPadding(dp(12), dp(10), dp(12), dp(10));
        button.setBackground(roundRect(Color.rgb(238, 241, 246), 14));
        return button;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radiusDp));
        return drawable;
    }

    private LinearLayout.LayoutParams margin(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(left, top, right, bottom);
        return params;
    }

    private LinearLayout.LayoutParams fixed(int width, int height, int right) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.setMargins(0, 0, right, 0);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
