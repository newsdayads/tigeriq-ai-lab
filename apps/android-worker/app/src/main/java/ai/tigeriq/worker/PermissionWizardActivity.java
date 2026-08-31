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
import android.os.PowerManager;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.lang.reflect.Method;

/** One-time phone-first setup. Completed devices skip directly to HomeActivity on later launches. */
public final class PermissionWizardActivity extends Activity {
    public static final String EXTRA_FORCE_SETUP = "forceSetup";
    private static final int NOTIFICATION_REQUEST = 7001;
    private static final String GEMINI_PACKAGE = "com.google.android.apps.bard";
    private static final int NAVY = Color.rgb(17, 24, 39);
    private static final int ORANGE = Color.rgb(244, 113, 31);
    private static final int GOLD = Color.rgb(250, 190, 58);
    private static final int INK = Color.rgb(22, 31, 46);
    private static final int MUTED = Color.rgb(92, 105, 125);
    private static final int SURFACE = Color.rgb(246, 247, 251);
    private static final int GREEN = Color.rgb(20, 137, 97);
    private static final int RED = Color.rgb(190, 54, 54);

    private TextView summary;
    private TextView securityState;
    private TextView notificationState;
    private TextView accessibilityState;
    private TextView batteryState;
    private TextView geminiState;
    private Button continueButton;
    private boolean forceSetup;
    private boolean accessibilitySettingsLaunched;
    private boolean diagnosticDialogShown;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        forceSetup = getIntent() != null && getIntent().getBooleanExtra(EXTRA_FORCE_SETUP, false);
        startWorkerService();
        if (!forceSetup && SetupStateStore.completed(this) && ready()) {
            openHome();
            return;
        }
        setContentView(buildScreen());
        refresh();
    }

    @Override protected void onResume() {
        super.onResume();
        SetupStateStore.confirmGeminiReturn(this);
        if (summary != null) refresh();

        if (accessibilitySettingsLaunched) {
            accessibilitySettingsLaunched = false;
            if (!accessibilityEnabled() && !diagnosticDialogShown) {
                getWindow().getDecorView().postDelayed(this::showAccessibilityDiagnosis, 350);
            }
        }
    }

    @Override public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIFICATION_REQUEST) refresh();
    }

    private View buildScreen() {
        LinearLayout shell = new LinearLayout(this);
        shell.setOrientation(LinearLayout.VERTICAL);
        shell.setBackgroundColor(SURFACE);

        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(18), dp(16), dp(18), dp(16));
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
        TextView subtitle = text("THIẾT LẬP NHÂN VIÊN AI", 11, true);
        subtitle.setTextColor(GOLD);
        brand.addView(subtitle);
        header.addView(brand);
        shell.addView(header);

        ScrollView scroll = new ScrollView(this);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(18), dp(18), dp(18), dp(34));
        scroll.addView(root);
        shell.addView(scroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout intro = card();
        intro.addView(text("Cấp quyền một lần", 20, true));
        summary = text("TigerIQ sẽ mở đúng màn hình hệ thống và tự kiểm tra khi quay lại.", 13, false);
        summary.setTextColor(MUTED);
        intro.addView(summary, margin(0, dp(7), 0, 0));
        TextView device = text("Samsung Z Flip / Z Fold · Android 8 trở lên", 12, true);
        device.setTextColor(GREEN);
        intro.addView(device, margin(0, dp(9), 0, 0));
        securityState = text("Đang kiểm tra lớp bảo vệ Android…", 12, true);
        securityState.setTextColor(MUTED);
        intro.addView(securityState, margin(0, dp(7), 0, 0));
        root.addView(intro);

        TextView note = text("Không cần PC01. Nếu Android 16 bật Bảo vệ nâng cao, TigerIQ sẽ báo đúng nguyên nhân thay vì bắt tìm một nút không tồn tại.", 13, false);
        note.setTextColor(MUTED);
        root.addView(note, margin(0, dp(16), 0, dp(10)));

        notificationState = addStep(root, "1", "Cho phép thông báo", "Đang kiểm tra…", "CHO PHÉP", v -> requestNotifications());
        accessibilityState = addStep(root, "2", "Cho phép điều khiển màn hình", "Đang kiểm tra…", "MỞ TRỢ NĂNG", v -> openAccessibility());
        batteryState = addStep(root, "3", "Cho phép chạy liên tục", "Đang kiểm tra…", "BỎ GIỚI HẠN PIN", v -> requestBattery());
        geminiState = addStep(root, "4", "Xác nhận Gemini", "Đang kiểm tra…", "MỞ GEMINI", v -> openGemini());

        Button blockerHelp = secondaryButton("QUYỀN ĐIỀU KHIỂN BỊ CHẶN? CHẨN ĐOÁN");
        blockerHelp.setOnClickListener(v -> showAccessibilityDiagnosis());
        root.addView(blockerHelp, margin(0, dp(8), 0, dp(16)));

        continueButton = primaryButton("BẮT ĐẦU LÀM VIỆC");
        continueButton.setOnClickListener(v -> {
            if (!ready()) {
                Toast.makeText(this, "Còn bước chưa hoàn tất", Toast.LENGTH_SHORT).show();
                return;
            }
            SetupStateStore.markCompleted(this);
            openHome();
        });
        root.addView(continueButton);

        TextView privacy = text("TigerIQ không tự bật hoặc vượt qua quyền Accessibility. Android bắt buộc chủ thiết bị xác nhận. Ứng dụng chỉ mở đúng trang, kiểm tra trạng thái và giải thích chính xác lớp bảo vệ đang chặn.", 11, false);
        privacy.setTextColor(MUTED);
        root.addView(privacy, margin(0, dp(14), 0, 0));
        return shell;
    }

    private TextView addStep(LinearLayout root, String number, String title, String state, String action, View.OnClickListener listener) {
        LinearLayout box = card();
        LinearLayout top = new LinearLayout(this);
        top.setGravity(Gravity.CENTER_VERTICAL);
        TextView badge = text(number, 15, true);
        badge.setGravity(Gravity.CENTER);
        badge.setTextColor(Color.WHITE);
        badge.setBackground(roundRect(ORANGE, 20));
        top.addView(badge, fixed(dp(38), dp(38), dp(12)));
        LinearLayout copy = new LinearLayout(this);
        copy.setOrientation(LinearLayout.VERTICAL);
        copy.addView(text(title, 15, true));
        TextView stateView = text(state, 12, false);
        stateView.setTextColor(MUTED);
        copy.addView(stateView, margin(0, dp(2), 0, 0));
        top.addView(copy, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        box.addView(top);
        Button button = primaryButton(action);
        button.setOnClickListener(listener);
        box.addView(button, margin(0, dp(12), 0, 0));
        root.addView(box, margin(0, 0, 0, dp(10)));
        return stateView;
    }

    private void refresh() {
        boolean n = notificationGranted();
        boolean a = accessibilityEnabled();
        boolean b = batteryGranted();
        boolean installed = geminiInstalled();
        boolean g = installed && SetupStateStore.geminiConfirmed(this);
        Boolean advanced = advancedProtectionEnabled();

        if (!installed && SetupStateStore.geminiConfirmed(this)) SetupStateStore.clearGeminiConfirmation(this);

        if (Build.VERSION.SDK_INT >= 36) {
            if (Boolean.TRUE.equals(advanced)) {
                securityState.setText("⚠ Android 16: Bảo vệ nâng cao đang BẬT");
                securityState.setTextColor(RED);
            } else if (Boolean.FALSE.equals(advanced)) {
                securityState.setText("✓ Android 16: Bảo vệ nâng cao đang TẮT");
                securityState.setTextColor(GREEN);
            } else {
                securityState.setText("Android 16: chưa đọc được trạng thái Bảo vệ nâng cao");
                securityState.setTextColor(MUTED);
            }
        } else {
            securityState.setText("✓ Không dùng lớp Bảo vệ nâng cao Android 16");
            securityState.setTextColor(GREEN);
        }

        setState(notificationState, n, n ? "✓ Đã cấp quyền" : "Chưa cấp — bấm nút bên dưới");
        if (a) {
            setState(accessibilityState, true, "✓ Đã bật TigerIQ AI Worker");
        } else if (Boolean.TRUE.equals(advanced)) {
            setState(accessibilityState, false, "Bị Android 16 Bảo vệ nâng cao chặn — bấm CHẨN ĐOÁN");
        } else {
            setState(accessibilityState, false, "Chưa bật — bấm MỞ TRỢ NĂNG và thử bật TigerIQ");
        }
        setState(batteryState, b, b ? "✓ Đã cho phép chạy liên tục" : "Chưa bỏ giới hạn pin");
        if (!installed) setState(geminiState, false, "Chưa tìm thấy Gemini trên máy");
        else setState(geminiState, g, g ? "✓ Đã mở Gemini và quay lại TigerIQ" : "Bấm MỞ GEMINI, sau đó quay lại TigerIQ");

        boolean ready = n && a && b && installed && g;
        summary.setText(ready
            ? "✓ ĐÃ ĐỦ QUYỀN — bấm BẮT ĐẦU LÀM VIỆC."
            : "Hoàn tất các bước màu cam. TigerIQ sẽ tự kiểm tra lại khi quay về ứng dụng.");
        summary.setTextColor(ready ? GREEN : MUTED);
        continueButton.setEnabled(ready);
        continueButton.setAlpha(ready ? 1f : 0.42f);
    }

    private void requestNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && !notificationGranted()) {
            requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATION_REQUEST);
        } else refresh();
    }

    private void openAccessibility() {
        accessibilitySettingsLaunched = true;
        try {
            startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            Toast.makeText(this, "Trong Trợ năng, chọn TigerIQ AI Worker và thử bật Cho phép.", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            showAccessibilityDiagnosis();
        }
    }

    private void showAccessibilityDiagnosis() {
        if (isFinishing() || diagnosticDialogShown) return;
        diagnosticDialogShown = true;
        Boolean advanced = advancedProtectionEnabled();

        if (Boolean.TRUE.equals(advanced)) {
            new AlertDialog.Builder(this)
                .setTitle("Android 16 đang chặn Accessibility")
                .setMessage("Bảo vệ nâng cao (Advanced Protection) đang BẬT. Android 16 có thể chặn dịch vụ Accessibility của ứng dụng tự động hóa cài ngoài Store. TigerIQ không thể và không nên tự vượt qua lớp bảo vệ này.\n\nNếu Sếp chấp nhận giảm lớp bảo vệ trên thiết bị này: mở Bảo mật & riêng tư → Bảo vệ nâng cao → tắt Bảo vệ thiết bị, rồi quay lại TigerIQ và bấm MỞ TRỢ NĂNG.")
                .setNegativeButton("ĐÓNG", (dialog, which) -> diagnosticDialogShown = false)
                .setPositiveButton("MỞ BẢO MẬT", (dialog, which) -> {
                    diagnosticDialogShown = false;
                    openSecuritySettings();
                })
                .setOnCancelListener(dialog -> diagnosticDialogShown = false)
                .show();
            return;
        }

        new AlertDialog.Builder(this)
            .setTitle("Không thấy 'Cho phép cài đặt bị hạn chế'?")
            .setMessage("Không tiếp tục giả định menu đó luôn tồn tại. Trên một số bản Android/Samsung, mục này chỉ xuất hiện sau khi hệ thống đã chặn một lần.\n\nLàm theo thứ tự:\n1. Bấm THỬ BẬT TRỢ NĂNG và thử bật TigerIQ AI Worker.\n2. Nếu Android hiện 'Cài đặt bị hạn chế', đóng cảnh báo.\n3. Quay lại đây → MỞ THÔNG TIN APP → ⋮. Nếu Android có mục 'Cho phép cài đặt bị hạn chế' thì chọn nó.\n4. Nếu menu vẫn không có, quay lại TigerIQ; không gỡ ứng dụng.\n\nTigerIQ v0.6.2 không còn coi việc thiếu menu này là lỗi APK.")
            .setNeutralButton("THÔNG TIN APP", (dialog, which) -> {
                diagnosticDialogShown = false;
                openAppDetails();
            })
            .setNegativeButton("ĐÓNG", (dialog, which) -> diagnosticDialogShown = false)
            .setPositiveButton("THỬ BẬT TRỢ NĂNG", (dialog, which) -> {
                diagnosticDialogShown = false;
                openAccessibility();
            })
            .setOnCancelListener(dialog -> diagnosticDialogShown = false)
            .show();
    }

    private Boolean advancedProtectionEnabled() {
        if (Build.VERSION.SDK_INT < 36) return Boolean.FALSE;
        try {
            Class<?> managerClass = Class.forName("android.security.advancedprotection.AdvancedProtectionManager");
            Method getSystemService = Context.class.getMethod("getSystemService", Class.class);
            Object manager = getSystemService.invoke(this, managerClass);
            if (manager == null) return null;
            Method isEnabled = managerClass.getMethod("isAdvancedProtectionEnabled");
            Object value = isEnabled.invoke(manager);
            return value instanceof Boolean ? (Boolean) value : null;
        } catch (Throwable ignored) {
            return null;
        }
    }

    private void openSecuritySettings() {
        try {
            startActivity(new Intent(Settings.ACTION_SECURITY_SETTINGS));
            Toast.makeText(this, "Mở Bảo vệ nâng cao nếu máy có mục này.", Toast.LENGTH_LONG).show();
        } catch (Exception ignored) {
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        }
    }

    private void requestBattery() {
        if (batteryGranted()) { refresh(); return; }
        try {
            Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            intent.setData(Uri.parse("package:" + getPackageName()));
            startActivity(intent);
        } catch (Exception first) {
            try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); }
            catch (Exception ignored) { openAppDetails(); }
        }
    }

    private void openAppDetails() {
        startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
    }

    private void openGemini() {
        Intent launch = getPackageManager().getLaunchIntentForPackage(GEMINI_PACKAGE);
        if (launch == null) {
            SetupStateStore.clearGeminiConfirmation(this);
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + GEMINI_PACKAGE))); }
            catch (Exception ignored) { Toast.makeText(this, "Chưa cài Gemini", Toast.LENGTH_LONG).show(); }
            return;
        }
        SetupStateStore.markGeminiLaunch(this);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(launch);
        Toast.makeText(this, "Gemini đã mở. Chỉ cần quay lại TigerIQ.", Toast.LENGTH_LONG).show();
    }

    private boolean notificationGranted() {
        return Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean batteryGranted() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
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

    private boolean geminiInstalled() {
        return getPackageManager().getLaunchIntentForPackage(GEMINI_PACKAGE) != null;
    }

    private boolean ready() {
        return notificationGranted() && accessibilityEnabled() && batteryGranted()
            && geminiInstalled() && SetupStateStore.geminiConfirmed(this);
    }

    private void openHome() {
        startActivity(new Intent(this, HomeActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP));
        finish();
    }

    private void startWorkerService() {
        Intent service = new Intent(this, ForegroundWorkerService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(service); else startService(service);
    }

    private void setState(TextView view, boolean pass, String value) {
        view.setText(value);
        view.setTextColor(pass ? GREEN : RED);
    }

    private TextView text(String value, int sp, boolean bold) {
        TextView v = new TextView(this);
        v.setText(value);
        v.setTextSize(sp);
        v.setTextColor(INK);
        if (bold) v.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return v;
    }

    private LinearLayout card() {
        LinearLayout v = new LinearLayout(this);
        v.setOrientation(LinearLayout.VERTICAL);
        v.setPadding(dp(16), dp(16), dp(16), dp(16));
        v.setBackground(roundRect(Color.WHITE, 18));
        return v;
    }

    private Button primaryButton(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextColor(Color.WHITE);
        b.setTextSize(13);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setAllCaps(false);
        b.setBackground(roundRect(ORANGE, 14));
        b.setPadding(dp(12), dp(12), dp(12), dp(12));
        return b;
    }

    private Button secondaryButton(String label) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextColor(INK);
        b.setTextSize(11);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setAllCaps(false);
        b.setBackground(roundRect(Color.rgb(234, 237, 243), 14));
        b.setPadding(dp(12), dp(11), dp(12), dp(11));
        return b;
    }

    private GradientDrawable roundRect(int color, int radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radiusDp));
        return d;
    }

    private LinearLayout.LayoutParams margin(int l, int t, int r, int b) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        p.setMargins(l, t, r, b);
        return p;
    }

    private LinearLayout.LayoutParams fixed(int w, int h, int right) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(w, h);
        p.setMargins(0, 0, right, 0);
        return p;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
