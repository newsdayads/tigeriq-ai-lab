package ai.tigeriq.worker;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
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

import java.util.Locale;

/** Phone-first owner surface for one TigerIQ Android AI employee. */
public final class MainActivity extends Activity {
    private static final int NOTIFICATION_PERMISSION_REQUEST = 1001;
    private static final String GEMINI_PACKAGE = "com.google.android.apps.bard";
    private static final String TAILSCALE_PACKAGE = "com.tailscale.ipn";

    // TigerIQ brand palette.
    private static final int NAVY = Color.rgb(17, 24, 39);
    private static final int NAVY_2 = Color.rgb(30, 41, 59);
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

    private TextView employeeLine;
    private TextView readinessTitle;
    private TextView readinessCopy;
    private TextView notificationState;
    private TextView accessibilityState;
    private TextView batteryState;
    private TextView geminiState;
    private LinearLayout taskCard;
    private EditText taskInput;
    private Button taskButton;
    private TextView taskState;
    private TextView resultView;
    private Button openResultButton;

    private final Runnable refreshLoop = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            refreshUi();
            handler.postDelayed(this, 1500L);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WorkerIdentity.ensureDeviceKey();
        setContentView(buildScreen());
        startWorkerService();
        requestNotificationPermissionIfNeeded();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        handler.removeCallbacks(refreshLoop);
        handler.post(refreshLoop);
    }

    @Override
    protected void onPause() {
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
        scroll.setFillViewport(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(36));
        scroll.addView(root);
        shell.addView(scroll, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout readiness = card();
        readinessTitle = text("ĐANG KIỂM TRA", 20, true);
        readinessCopy = text("Ứng dụng đang kiểm tra các quyền cần thiết.", 13, false);
        readiness.addView(readinessTitle);
        readiness.addView(readinessCopy, marginParams(0, dp(6), 0, 0));
        root.addView(readiness);

        root.addView(sectionTitle("Thiết lập nhanh"), marginParams(0, dp(22), 0, dp(6)));
        TextView setupHint = text("Chỉ cần hoàn tất 4 bước này một lần. Không cần PC01 để bắt đầu làm việc.", 13, false);
        setupHint.setTextColor(MUTED);
        root.addView(setupHint, marginParams(0, 0, 0, dp(10)));

        LinearLayout setupCard = card();
        notificationState = addStep(setupCard, "1", "Cho phép Worker chạy nền", "Đang kiểm tra…", "CHO PHÉP", v -> requestNotificationPermissionIfNeeded());
        accessibilityState = addStep(setupCard, "2", "Bật quyền điều khiển", "Đang kiểm tra…", "MỞ CÀI ĐẶT", v -> openAccessibilitySettings());
        batteryState = addStep(setupCard, "3", "Không giới hạn pin cho Worker", "Đang kiểm tra…", "CẤP QUYỀN", v -> requestBatteryExemption());
        geminiState = addStep(setupCard, "4", "Xác nhận Gemini sẵn sàng", "Đang kiểm tra…", "MỞ GEMINI", v -> openGeminiForSetup());
        root.addView(setupCard);

        root.addView(sectionTitle("Giao việc"), marginParams(0, dp(22), 0, dp(6)));
        taskCard = card();
        TextView taskHint = text("Nhập việc cần làm. TigerIQ sẽ mở Gemini, nhập yêu cầu và gửi tự động bằng Accessibility.", 13, false);
        taskHint.setTextColor(MUTED);
        taskCard.addView(taskHint);
        taskInput = new EditText(this);
        taskInput.setHint("Ví dụ: Tìm 5 công cụ AI miễn phí để quản lý công việc và so sánh ưu nhược điểm.");
        taskInput.setTextSize(15);
        taskInput.setTextColor(INK);
        taskInput.setHintTextColor(Color.rgb(135, 145, 160));
        taskInput.setMinLines(3);
        taskInput.setGravity(Gravity.TOP | Gravity.START);
        taskInput.setPadding(dp(14), dp(12), dp(14), dp(12));
        taskInput.setBackground(roundRect(Color.rgb(242, 244, 248), 14));
        taskCard.addView(taskInput, marginParams(0, dp(12), 0, dp(10)));
        taskButton = primaryButton("GIAO VIỆC");
        taskButton.setOnClickListener(v -> submitLocalTask());
        taskCard.addView(taskButton);
        taskState = text("Chưa có công việc đang chạy.", 13, true);
        taskCard.addView(taskState, marginParams(0, dp(12), 0, 0));
        root.addView(taskCard);

        root.addView(sectionTitle("Kết quả gần nhất"), marginParams(0, dp(22), 0, dp(6)));
        LinearLayout resultCard = card();
        resultView = text("Chưa có kết quả.", 14, false);
        resultView.setTextColor(MUTED);
        resultCard.addView(resultView);
        openResultButton = secondaryButton("MỞ GEMINI KIỂM TRA");
        openResultButton.setOnClickListener(v -> openGemini());
        resultCard.addView(openResultButton, marginParams(0, dp(12), 0, 0));
        root.addView(resultCard);

        Button advanced = secondaryButton("KẾT NỐI NÂNG CAO");
        advanced.setOnClickListener(v -> showAdvanced());
        root.addView(advanced, marginParams(0, dp(20), 0, 0));

        TextView safety = text("PC01 và Tailscale hiện là tùy chọn nâng cao. Local Worker trên điện thoại là đường chạy chính.", 12, false);
        safety.setTextColor(MUTED);
        root.addView(safety, marginParams(0, dp(10), 0, 0));

        return shell;
    }

    private View brandHeader() {
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(18), dp(14), dp(18), dp(14));
        header.setBackgroundColor(NAVY);

        TextView mark = text("TI", 18, true);
        mark.setTextColor(NAVY);
        mark.setGravity(Gravity.CENTER);
        mark.setBackground(roundRect(GOLD, 18));
        header.addView(mark, fixedParams(dp(42), dp(42), 0, 0, dp(12), 0));

        LinearLayout words = new LinearLayout(this);
        words.setOrientation(LinearLayout.VERTICAL);
        TextView name = text("TigerIQ AI", 20, true);
        name.setTextColor(Color.WHITE);
        words.addView(name);
        employeeLine = text("ANDROID WORKER · PHONE-FIRST", 11, true);
        employeeLine.setTextColor(GOLD);
        words.addView(employeeLine, marginParams(0, dp(2), 0, 0));
        header.addView(words, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        TextView local = text("LOCAL", 10, true);
        local.setTextColor(Color.WHITE);
        local.setGravity(Gravity.CENTER);
        local.setPadding(dp(10), dp(6), dp(10), dp(6));
        local.setBackground(roundRect(ORANGE, 18));
        header.addView(local);
        return header;
    }

    private TextView addStep(LinearLayout parent, String number, String title, String initial, String action, View.OnClickListener listener) {
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(6), 0, dp(10));

        TextView numberView = text(number, 15, true);
        numberView.setTextColor(Color.WHITE);
        numberView.setGravity(Gravity.CENTER);
        numberView.setBackground(roundRect(ORANGE, 18));
        row.addView(numberView, fixedParams(dp(36), dp(36), 0, 0, dp(12), 0));

        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        TextView titleView = text(title, 14, true);
        copy.addView(titleView);
        TextView state = text(initial, 12, false);
        state.setTextColor(MUTED);
        copy.addView(state, marginParams(0, dp(2), 0, 0));
        row.addView(copy, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        Button button = secondaryButton(action);
        button.setTextSize(10);
        button.setMinHeight(0);
        button.setMinimumHeight(0);
        button.setPadding(dp(10), dp(8), dp(10), dp(8));
        button.setOnClickListener(listener);
        row.addView(button);

        parent.addView(row);
        return state;
    }

    private void refreshUi() {
        boolean notification = notificationGranted();
        boolean accessibility = accessibilityEnabled();
        boolean battery = batteryUnrestricted();
        boolean gemini = geminiInstalled();
        boolean geminiSeen = geminiObserved();
        boolean ready = notification && accessibility && battery && gemini && geminiSeen;

        EmployeeProfileStore.Profile profile = new EmployeeProfileStore(this).load();
        String employee = profile.employeeId == null || profile.employeeId.trim().isEmpty() ? "Z Flip 7" : profile.employeeId.trim();
        String role = profile.role == null || profile.role.trim().isEmpty() ? "Research" : profile.role.trim();
        employeeLine.setText((employee + " · " + role + " · GEMINI").toUpperCase(Locale.ROOT));

        setStep(notificationState, notification, notification ? "Đã cho phép · Worker chạy nền" : "Cần cho phép thông báo để Worker chạy ổn định");
        setStep(accessibilityState, accessibility, accessibility ? "Đã bật · TigerIQ có thể thao tác ứng dụng" : "Chưa bật · đây là quyền bắt buộc");
        setStep(batteryState, battery, battery ? "Đã bỏ giới hạn pin" : "Cần bỏ giới hạn để Worker không bị Samsung dừng");
        if (!gemini) setStep(geminiState, false, "Chưa tìm thấy ứng dụng Gemini");
        else if (!geminiSeen) setStep(geminiState, false, "Đã cài · bấm MỞ GEMINI một lần rồi quay lại");
        else setStep(geminiState, true, "Đã thấy Gemini · sẵn sàng nhận việc");

        LocalTaskStore.Snapshot task = LocalTaskStore.load(this);
        boolean working = task.active();
        if (working) {
            readinessTitle.setText("ĐANG LÀM VIỆC");
            readinessTitle.setTextColor(AMBER);
            readinessCopy.setText("TigerIQ đang thực hiện công việc trên Gemini. Không cần PC01.");
            setCardBackground((View) readinessTitle.getParent(), Color.rgb(255, 248, 228));
        } else if (ready) {
            readinessTitle.setText("SẴN SÀNG");
            readinessTitle.setTextColor(GREEN);
            readinessCopy.setText("Điện thoại đã đủ điều kiện. Có thể giao việc ngay.");
            setCardBackground((View) readinessTitle.getParent(), Color.rgb(231, 248, 240));
        } else {
            readinessTitle.setText("CẦN THIẾT LẬP");
            readinessTitle.setTextColor(RED);
            readinessCopy.setText("Hoàn tất các bước màu cam bên dưới. Mỗi bước chỉ cần bấm một lần.");
            setCardBackground((View) readinessTitle.getParent(), Color.rgb(255, 239, 237));
        }

        taskButton.setEnabled(ready && !working);
        taskButton.setAlpha(taskButton.isEnabled() ? 1f : 0.45f);
        taskInput.setEnabled(!working);
        taskState.setText(taskStateText(task));
        taskState.setTextColor(LocalTaskStore.FAILED.equals(task.state) ? RED : (LocalTaskStore.RESULT_READY.equals(task.state) ? GREEN : MUTED));

        if (LocalTaskStore.RESULT_READY.equals(task.state) && !task.result.isEmpty()) {
            resultView.setText(task.result);
            resultView.setTextColor(INK);
        } else if (LocalTaskStore.FAILED.equals(task.state)) {
            resultView.setText("Chưa lấy được kết quả tự động. Lý do: " + friendlyError(task.error));
            resultView.setTextColor(RED);
        } else if (task.active()) {
            resultView.setText("Đang chờ Gemini hoàn tất…");
            resultView.setTextColor(MUTED);
        } else {
            resultView.setText("Chưa có kết quả.");
            resultView.setTextColor(MUTED);
        }
    }

    private void submitLocalTask() {
        if (!localReady()) {
            Toast.makeText(this, "Hoàn tất 4 bước thiết lập trước", Toast.LENGTH_SHORT).show();
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
            Toast.makeText(this, "Đã giao việc · TigerIQ đang mở Gemini", Toast.LENGTH_SHORT).show();
        }
        refreshUi();
    }

    private boolean localReady() {
        return notificationGranted() && accessibilityEnabled() && batteryUnrestricted() && geminiInstalled() && geminiObserved();
    }

    private String taskStateText(LocalTaskStore.Snapshot task) {
        if (LocalTaskStore.QUEUED.equals(task.state)) return "1/3 · Đang mở Gemini và tìm ô nhập…";
        if (LocalTaskStore.INPUT_SET.equals(task.state)) return "2/3 · Đã nhập yêu cầu · đang tìm nút Gửi…";
        if (LocalTaskStore.SUBMITTED.equals(task.state)) return "3/3 · Đã gửi · đang chờ Gemini trả lời…";
        if (LocalTaskStore.RESULT_READY.equals(task.state)) return "HOÀN TẤT · Đã lấy được kết quả";
        if (LocalTaskStore.FAILED.equals(task.state)) return "CẦN KIỂM TRA · " + friendlyError(task.error);
        return "Chưa có công việc đang chạy.";
    }

    private String friendlyError(String error) {
        if (error == null) return "Không xác định";
        switch (error) {
            case "TIMEOUT": return "Gemini không hoàn tất trong thời gian cho phép";
            case "ACCESSIBILITY_DISABLED": return "Quyền điều khiển đã bị tắt";
            case "APP_NOT_INSTALLED": return "Chưa cài Gemini";
            case "LOGIN_REQUIRED": return "Gemini yêu cầu đăng nhập";
            case "UI_CHANGED": return "Giao diện Gemini thay đổi nên TigerIQ chưa nhận diện được";
            case "PROVIDER_LIMIT": return "Gemini đang giới hạn sử dụng";
            default: return error;
        }
    }

    private void setStep(TextView state, boolean pass, String copy) {
        state.setText((pass ? "✓ " : "• ") + copy);
        state.setTextColor(pass ? GREEN : ORANGE);
    }

    private void setCardBackground(View card, int color) {
        if (card != null) card.setBackground(roundRect(color, 18));
    }

    private void requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_PERMISSION_REQUEST);
        } else {
            startWorkerService();
        }
    }

    private boolean notificationGranted() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void openAccessibilitySettings() {
        startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
    }

    private boolean accessibilityEnabled() {
        String expected = new ComponentName(this, AccessibilityBridgeService.class).flattenToString();
        String enabled = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        for (String service : enabled.split(":")) if (expected.equalsIgnoreCase(service)) return true;
        return false;
    }

    private boolean batteryUnrestricted() {
        PowerManager manager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        return manager != null && manager.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void requestBatteryExemption() {
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (Exception ignored) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private boolean geminiInstalled() {
        return getPackageManager().getLaunchIntentForPackage(GEMINI_PACKAGE) != null;
    }

    private boolean geminiObserved() {
        String last = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE)
            .getString(AccessibilityBridgeService.KEY_LAST_PACKAGE, "");
        return GEMINI_PACKAGE.equals(last);
    }

    private void openGeminiForSetup() {
        if (!openGemini()) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + GEMINI_PACKAGE)));
            } catch (Exception ignored) {
                Toast.makeText(this, "Hãy cài ứng dụng Google Gemini", Toast.LENGTH_LONG).show();
            }
        }
    }

    private boolean openGemini() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(GEMINI_PACKAGE);
        if (launch == null) return false;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(launch);
        return true;
    }

    private void showAdvanced() {
        EmployeeProfileStore.Profile profile = new EmployeeProfileStore(this).load();
        String controller = getSharedPreferences(ForegroundWorkerService.PREFS, MODE_PRIVATE)
            .getString(ForegroundWorkerService.KEY_CONTROLLER_STATE, "OPTIONAL_UNPAIRED");
        String lastPackage = getSharedPreferences(AccessibilityBridgeService.PREFS, MODE_PRIVATE)
            .getString(AccessibilityBridgeService.KEY_LAST_PACKAGE, "Chưa có");
        new AlertDialog.Builder(this)
            .setTitle("Kết nối nâng cao")
            .setMessage(
                "Chế độ hiện tại: PHONE-FIRST / LOCAL\n\n" +
                "PC01 Controller: " + controller + "\n" +
                "Tailscale: không bắt buộc cho Local Worker\n" +
                "Nhân viên: " + profile.employeeId + "\n" +
                "Ứng dụng gần nhất Worker thấy: " + lastPackage + "\n\n" +
                "Chỉ cần Tailscale/Controller khi muốn điều phối điện thoại từ xa sau này."
            )
            .setPositiveButton("MỞ TAILSCALE", (d, w) -> openTailscale())
            .setNegativeButton("ĐÓNG", null)
            .show();
    }

    private void openTailscale() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(TAILSCALE_PACKAGE);
        if (launch != null) startActivity(launch);
        else Toast.makeText(this, "Tailscale là tùy chọn và chưa được cài", Toast.LENGTH_SHORT).show();
    }

    private void startWorkerService() {
        Intent service = new Intent(this, ForegroundWorkerService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
    }

    private TextView sectionTitle(String value) {
        TextView view = text(value, 19, true);
        view.setTextColor(INK);
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

    private TextView text(String value, int sp, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(sp);
        view.setTextColor(INK);
        view.setLineSpacing(0f, 1.08f);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
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
        button.setTextColor(NAVY_2);
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

    private LinearLayout.LayoutParams marginParams(int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        params.setMargins(left, top, right, bottom);
        return params;
    }

    private LinearLayout.LayoutParams fixedParams(int width, int height, int left, int top, int right, int bottom) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(width, height);
        params.setMargins(left, top, right, bottom);
        return params;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
