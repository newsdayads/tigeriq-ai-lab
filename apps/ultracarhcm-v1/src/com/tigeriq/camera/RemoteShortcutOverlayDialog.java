package com.tigeriq.camera;

import android.app.Activity;
import android.app.Dialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.hardware.display.DisplayManager;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.util.TypedValue;
import android.view.Display;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.lang.ref.WeakReference;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;

/**
 * Floating overlay Dialog & shared panel for configuring Bluetooth Steering-Wheel Remote -> Camera Popup.
 * Runs as an in-window or TYPE_APPLICATION_OVERLAY Dialog so it NEVER hides or replaces UltraCar MainActivity on DeX.
 */
public final class RemoteShortcutOverlayDialog {
    private static final int TYPE_APPLICATION_OVERLAY = 2038;
    private static final int BADGE_VIEW_ID = 0x54495142;
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());

    private static Dialog activeDialog = null;
    private static PanelController activePanel = null;
    private static WeakReference<TextView> badgeRef = new WeakReference<TextView>(null);

    private RemoteShortcutOverlayDialog() {}

    public static void show(final Context callerCtx) {
        if (callerCtx == null) return;
        Runnable showTask = new Runnable() {
            @Override
            public void run() {
                showOnMainThread(callerCtx);
            }
        };
        if (Looper.myLooper() == Looper.getMainLooper()) {
            showTask.run();
        } else {
            MAIN_HANDLER.post(showTask);
        }
    }

    public static void dismissActive() {
        if (activePanel != null) {
            activePanel.onPause();
            activePanel = null;
        }
        if (activeDialog != null) {
            try {
                if (activeDialog.isShowing()) {
                    activeDialog.dismiss();
                }
            } catch (Throwable ignored) {
            }
            activeDialog = null;
        }
    }

    private static void showOnMainThread(Context callerCtx) {
        dismissActive();

        final Context appCtx = callerCtx.getApplicationContext();
        final boolean isLiveActivity = (callerCtx instanceof Activity)
            && !((Activity) callerCtx).isFinishing()
            && !((Activity) callerCtx).isDestroyed();
        final Context overlayUiCtx = resolveOverlayContext(appCtx);
        final boolean canOverlay = canDrawOverlaysCompat(appCtx);

        Context dialogCtx = null;
        boolean useOverlayWindow = false;
        if (!isLiveActivity && canOverlay && overlayUiCtx != null) {
            dialogCtx = overlayUiCtx;
            useOverlayWindow = true;
        } else if (isLiveActivity) {
            dialogCtx = callerCtx;
        } else if (canOverlay && overlayUiCtx != null) {
            dialogCtx = overlayUiCtx;
            useOverlayWindow = true;
        }

        if (dialogCtx == null) {
            launchFallbackActivity(appCtx);
            return;
        }

        try {
            final Dialog dialog = new Dialog(dialogCtx);
            dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
            Window win = dialog.getWindow();
            if (win != null) {
                if (useOverlayWindow) {
                    win.setType(TYPE_APPLICATION_OVERLAY);
                }
                win.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
                win.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN);
            }

            final PanelController panel = new PanelController(dialogCtx, new Runnable() {
                @Override
                public void run() {
                    dialog.dismiss();
                }
            });
            View rootView = panel.buildRootCard();
            dialog.setContentView(rootView);
            dialog.setCancelable(true);
            dialog.setCanceledOnTouchOutside(true);

            dialog.setOnKeyListener(new DialogInterface.OnKeyListener() {
                @Override
                public boolean onKey(DialogInterface d, int keyCode, KeyEvent event) {
                    if (panel.onDirectKeyEvent(event)) {
                        return true;
                    }
                    if (keyCode == KeyEvent.KEYCODE_BACK && event != null && event.getAction() == KeyEvent.ACTION_UP) {
                        dialog.dismiss();
                        return true;
                    }
                    return false;
                }
            });

            dialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
                @Override
                public void onDismiss(DialogInterface d) {
                    panel.onPause();
                    if (activeDialog == dialog) {
                        activeDialog = null;
                        activePanel = null;
                    }
                    refreshBadgeFromStorage(appCtx);
                }
            });

            dialog.show();

            if (win != null) {
                DisplayMetrics dm = dialogCtx.getResources().getDisplayMetrics();
                int maxW = Math.min(dp(dialogCtx, 470), Math.max(dp(dialogCtx, 300), dm.widthPixels - dp(dialogCtx, 32)));
                int maxH = Math.min(dp(dialogCtx, 580), Math.max(dp(dialogCtx, 320), (int) (dm.heightPixels * 0.88f)));
                win.setLayout(maxW, WindowManager.LayoutParams.WRAP_CONTENT);
                WindowManager.LayoutParams wlp = win.getAttributes();
                if (wlp != null) {
                    wlp.gravity = Gravity.CENTER;
                    win.setAttributes(wlp);
                }
                View decor = win.getDecorView();
                if (decor != null && rootView instanceof ScrollView) {
                    ViewGroup.LayoutParams rlp = rootView.getLayoutParams();
                    if (rlp != null) {
                        rlp.height = ViewGroup.LayoutParams.WRAP_CONTENT;
                    }
                }
                rootView.setMinimumWidth(maxW);
                if (dm.heightPixels < dp(dialogCtx, 620) && rootView instanceof ScrollView) {
                    win.setLayout(maxW, maxH);
                }
            }

            activeDialog = dialog;
            activePanel = panel;
            panel.onResume();
        } catch (Throwable t) {
            launchFallbackActivity(appCtx);
        }
    }

    private static Context resolveOverlayContext(Context appCtx) {
        try {
            Class<?> fcsCls = Class.forName("com.ultracar.dexsplit.ui.service.FloatingCameraService");
            Field f = fcsCls.getField("sOverlayContext");
            Object val = f.get(null);
            if (val instanceof Context) {
                return (Context) val;
            }
        } catch (Throwable ignored) {
        }
        try {
            DisplayManager dm = (DisplayManager) appCtx.getSystemService(Context.DISPLAY_SERVICE);
            if (dm != null) {
                Display target = null;
                try {
                    Display[] dex = dm.getDisplays("com.samsung.android.hardware.display.category.DESKTOP");
                    if (dex != null && dex.length > 0 && dex[0].isValid()) {
                        target = dex[0];
                    }
                } catch (Throwable ignored) {
                }
                if (target == null) {
                    Display[] all = dm.getDisplays();
                    if (all != null) {
                        for (Display d : all) {
                            if (d != null && d.isValid() && d.getDisplayId() != Display.DEFAULT_DISPLAY) {
                                target = d;
                                break;
                            }
                        }
                        if (target == null && all.length > 0) {
                            target = all[0];
                        }
                    }
                }
                if (target != null) {
                    Context dispCtx = appCtx.createDisplayContext(target);
                    if (Build.VERSION.SDK_INT >= 31) {
                        return dispCtx.createWindowContext(TYPE_APPLICATION_OVERLAY, null);
                    }
                    return dispCtx;
                }
            }
        } catch (Throwable ignored) {
        }
        return appCtx;
    }

    private static boolean canDrawOverlaysCompat(Context ctx) {
        try {
            return Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(ctx);
        } catch (Throwable ignored) {
            return false;
        }
    }

    private static void launchFallbackActivity(Context appCtx) {
        if (appCtx == null) return;
        try {
            Intent intent = new Intent(appCtx, RemoteShortcutConfigActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
            appCtx.startActivity(intent);
        } catch (Throwable ignored) {
        }
    }

    /**
     * Inserts a non-intrusive top entry inside FloatingQuickBar's '+' menu dialog so the user can
     * open Remote BT Settings directly on DeX over Maps/Be without ever repurposing the [R] button.
     */
    public static void addQuickBarEntry(final Context ctx, LinearLayout list, final Dialog parentDialog) {
        if (ctx == null || list == null) return;
        try {
            LinearLayout row = new LinearLayout(ctx);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setBackground(roundRectStatic(ctx, 0xFF102A1B, 0xFF2EA043, dp(ctx, 10)));
            row.setPadding(dp(ctx, 12), dp(ctx, 10), dp(ctx, 12), dp(ctx, 10));

            TextView icon = new TextView(ctx);
            icon.setText("🎛");
            icon.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
            icon.setPadding(0, 0, dp(ctx, 10), 0);
            row.addView(icon);

            TextView label = new TextView(ctx);
            boolean ready = RemoteKeyAccessibilityService.isAccessibilityEnabled(ctx) && RemoteKeyPrefs.isEnabled(ctx);
            label.setText(ready
                ? "Phím tắt Remote BT → Camera (Đang bật)"
                : "Cài đặt Remote BT → Camera Popup (< 2s)");
            label.setTextColor(0xFFFFFFFF);
            label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            label.setTypeface(null, Typeface.BOLD);
            row.addView(label, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

            row.setClickable(true);
            row.setFocusable(true);
            row.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (parentDialog != null) {
                        try {
                            parentDialog.dismiss();
                        } catch (Throwable ignored) {
                        }
                    }
                    show(ctx.getApplicationContext());
                }
            });

            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = dp(ctx, 8);
            list.addView(row, 0, lp);
        } catch (Throwable ignored) {
        }
    }

    /**
     * Attaches or refreshes the compact top-right "🎛 Remote BT" pill on MainActivity's window
     * when camera preview is closed, hiding automatically when camera popup opens.
     */
    public static void attachBadgeToActivity(final Activity activity) {
        if (activity == null || activity.isFinishing()) return;
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    View content = activity.findViewById(android.R.id.content);
                    if (!(content instanceof FrameLayout)) {
                        return;
                    }
                    FrameLayout root = (FrameLayout) content;
                    View existing = root.findViewById(BADGE_VIEW_ID);
                    final TextView badge;
                    if (existing instanceof TextView) {
                        badge = (TextView) existing;
                    } else {
                        badge = new TextView(activity);
                        badge.setId(BADGE_VIEW_ID);
                        badge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
                        badge.setTypeface(null, Typeface.BOLD);
                        badge.setPadding(dp(activity, 10), dp(activity, 5), dp(activity, 10), dp(activity, 5));
                        badge.setClickable(true);
                        badge.setFocusable(true);
                        badge.setOnClickListener(new View.OnClickListener() {
                            @Override
                            public void onClick(View v) {
                                show(activity);
                            }
                        });
                        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                            FrameLayout.LayoutParams.WRAP_CONTENT,
                            FrameLayout.LayoutParams.WRAP_CONTENT,
                            Gravity.TOP | Gravity.END
                        );
                        lp.topMargin = dp(activity, 10);
                        lp.rightMargin = dp(activity, 14);
                        root.addView(badge, lp);
                    }
                    badgeRef = new WeakReference<TextView>(badge);
                    refreshBadgeState(badge, activity, readCameraEnabledReflect());
                } catch (Throwable ignored) {
                }
            }
        });
    }

    public static void updateBadgeVisibility(final boolean cameraEnabled) {
        MAIN_HANDLER.post(new Runnable() {
            @Override
            public void run() {
                TextView badge = badgeRef.get();
                if (badge != null) {
                    refreshBadgeState(badge, badge.getContext(), cameraEnabled);
                }
            }
        });
    }

    private static void refreshBadgeFromStorage(Context ctx) {
        TextView badge = badgeRef.get();
        if (badge != null) {
            refreshBadgeState(badge, ctx, readCameraEnabledReflect());
        }
    }

    private static void refreshBadgeState(TextView badge, Context ctx, boolean cameraEnabled) {
        boolean accOk = RemoteKeyAccessibilityService.isAccessibilityEnabled(ctx);
        boolean active = accOk && RemoteKeyPrefs.isEnabled(ctx);
        badge.setText(active ? "🎛 Remote BT ●" : "🎛 Remote BT ○");
        badge.setTextColor(active ? 0xFF7EE787 : 0xFFFFD166);
        badge.setBackground(roundRectStatic(
            ctx,
            active ? 0xD90E2318 : 0xD91A222E,
            active ? 0xFF2EA043 : 0xFF8B949E,
            dp(ctx, 14)
        ));
        badge.setVisibility(cameraEnabled ? View.GONE : View.VISIBLE);
    }

    private static boolean readCameraEnabledReflect() {
        try {
            Class<?> bridgeCls = Class.forName("com.ultracar.dexsplit.ui.TigerIQBridge");
            return bridgeCls.getField("sCameraEnabled").getBoolean(null);
        } catch (Throwable ignored) {
            return false;
        }
    }

    /**
     * Shared interactive settings controller used by both the DeX Overlay Dialog and standalone fallback Activity.
     */
    public static final class PanelController {
        private final Context ctx;
        private final Runnable closeAction;

        private boolean learning = false;
        private MediaSession learnMediaSession = null;

        private TextView accStatusBadge;
        private TextView accHintText;
        private Button accEnableBtn;
        private Switch enableSwitch;
        private TextView selectedKeyBadge;
        private TextView lastKeyText;
        private Button useLastKeyBtn;
        private Button learnBtn;

        private final List<PresetChip> keyChips = new ArrayList<PresetChip>();
        private final List<HoldChip> holdChips = new ArrayList<HoldChip>();

        private static final class PresetChip {
            final int keyCode;
            final TextView view;

            PresetChip(int keyCode, TextView view) {
                this.keyCode = keyCode;
                this.view = view;
            }
        }

        private static final class HoldChip {
            final long holdMs;
            final TextView view;

            HoldChip(long holdMs, TextView view) {
                this.holdMs = holdMs;
                this.view = view;
            }
        }

        public PanelController(Context ctx, Runnable closeAction) {
            this.ctx = ctx;
            this.closeAction = closeAction;
        }

        public View buildRootCard() {
            ScrollView scroll = new ScrollView(ctx);
            scroll.setFillViewport(true);
            scroll.setBackground(roundRectStatic(ctx, 0xF50B121C, 0xFF2E4057, dp(ctx, 16)));

            LinearLayout root = new LinearLayout(ctx);
            root.setOrientation(LinearLayout.VERTICAL);
            int pad = dp(ctx, 16);
            root.setPadding(pad, pad, pad, dp(ctx, 18));
            scroll.addView(root);

            LinearLayout header = new LinearLayout(ctx);
            header.setOrientation(LinearLayout.HORIZONTAL);
            header.setGravity(Gravity.CENTER_VERTICAL);

            TextView title = new TextView(ctx);
            title.setText("Phím tắt Remote BT → Camera");
            title.setTextColor(0xFFF3F7FB);
            title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17.5f);
            title.setTypeface(null, Typeface.BOLD);
            header.addView(title, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

            TextView closeBtn = makePill("✕ Đóng", 0xFF233042, 0xFFD9E3F0);
            closeBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (closeAction != null) closeAction.run();
                }
            });
            header.addView(closeBtn);
            root.addView(header);

            TextView sub = new TextView(ctx);
            sub.setText("Bấm nhanh giữ nguyên nhạc/âm lượng. Bấm giữ (< 2 giây) tương đương bấm nút [R] Camera Popup.");
            sub.setTextColor(0xFF9FB0C4);
            sub.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
            sub.setPadding(0, dp(ctx, 4), 0, dp(ctx, 12));
            root.addView(sub);

            // Card 1: Accessibility Permission
            LinearLayout accCard = makeCard();
            accCard.addView(makeSectionTitle("1. Quyền Trợ Năng (chạy ngầm trên DeX / Vietmap)"));

            accStatusBadge = new TextView(ctx);
            accStatusBadge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
            accStatusBadge.setTypeface(null, Typeface.BOLD);
            accStatusBadge.setPadding(dp(ctx, 10), dp(ctx, 6), dp(ctx, 10), dp(ctx, 6));
            accCard.addView(accStatusBadge);

            accHintText = new TextView(ctx);
            accHintText.setTextColor(0xFFBAC7D6);
            accHintText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
            accHintText.setPadding(0, dp(ctx, 6), 0, dp(ctx, 8));
            accCard.addView(accHintText);

            accEnableBtn = new Button(ctx);
            accEnableBtn.setText("Mở Cài đặt Trợ năng để Bật");
            accEnableBtn.setAllCaps(false);
            accEnableBtn.setTextColor(Color.WHITE);
            accEnableBtn.setBackground(roundRectStatic(ctx, 0xFF1F6FEB, 0xFF4493F8, dp(ctx, 10)));
            accEnableBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (RemoteKeyAccessibilityService.tryAutoEnableIfPermitted(ctx)) {
                        Toast.makeText(ctx.getApplicationContext(), "Đã tự động bật Trợ năng UltraCar!", Toast.LENGTH_SHORT).show();
                        refreshUi();
                    } else {
                        Toast.makeText(
                            ctx.getApplicationContext(),
                            "Chọn: Ứng dụng đã cài đặt → UltraCar Phím tắt Remote BT → BẬT",
                            Toast.LENGTH_LONG
                        ).show();
                        if (closeAction != null) closeAction.run();
                        RemoteKeyAccessibilityService.openAccessibilitySettings(ctx);
                    }
                }
            });
            accCard.addView(accEnableBtn);
            root.addView(accCard);

            // Card 2: Key selection + Learn mode
            LinearLayout keyCard = makeCard();
            LinearLayout toggleRow = new LinearLayout(ctx);
            toggleRow.setOrientation(LinearLayout.HORIZONTAL);
            toggleRow.setGravity(Gravity.CENTER_VERTICAL);
            TextView swLabel = makeSectionTitle("2. Bật phím tắt Remote");
            swLabel.setPadding(0, 0, 0, 0);
            toggleRow.addView(swLabel, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            enableSwitch = new Switch(ctx);
            enableSwitch.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
                @Override
                public void onCheckedChanged(CompoundButton buttonView, boolean isChecked) {
                    RemoteKeyPrefs.setEnabled(ctx, isChecked);
                    RemoteKeyAccessibilityService.syncFromPrefs(ctx);
                }
            });
            toggleRow.addView(enableSwitch);
            keyCard.addView(toggleRow);

            selectedKeyBadge = new TextView(ctx);
            selectedKeyBadge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            selectedKeyBadge.setTypeface(null, Typeface.BOLD);
            selectedKeyBadge.setTextColor(0xFF7EE787);
            selectedKeyBadge.setPadding(0, dp(ctx, 8), 0, dp(ctx, 6));
            keyCard.addView(selectedKeyBadge);

            learnBtn = new Button(ctx);
            learnBtn.setAllCaps(false);
            learnBtn.setTextColor(Color.WHITE);
            learnBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    if (learning) {
                        stopLearnMode();
                    } else {
                        startLearnMode();
                    }
                }
            });
            keyCard.addView(learnBtn);

            lastKeyText = new TextView(ctx);
            lastKeyText.setTextColor(0xFF9FB0C4);
            lastKeyText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
            lastKeyText.setPadding(0, dp(ctx, 8), 0, dp(ctx, 4));
            keyCard.addView(lastKeyText);

            useLastKeyBtn = new Button(ctx);
            useLastKeyBtn.setAllCaps(false);
            useLastKeyBtn.setTextColor(0xFFFFFFFF);
            useLastKeyBtn.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
            useLastKeyBtn.setBackground(roundRectStatic(ctx, 0xFF1D4E35, 0xFF3FB950, dp(ctx, 8)));
            useLastKeyBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    int lastCode = RemoteKeyPrefs.getLastObservedKeyCode(ctx);
                    if (RemoteKeyShortcutEngine.isSafeMappableKey(lastCode)) {
                        onLearnedKey(lastCode);
                    }
                }
            });
            LinearLayout.LayoutParams ulp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            ulp.bottomMargin = dp(ctx, 8);
            keyCard.addView(useLastKeyBtn, ulp);

            TextView presetHdr = new TextView(ctx);
            presetHdr.setText("Hoặc chọn nhanh nút trên Remote vô lăng:");
            presetHdr.setTextColor(0xFFD0DBE8);
            presetHdr.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
            presetHdr.setPadding(0, dp(ctx, 2), 0, dp(ctx, 6));
            keyCard.addView(presetHdr);

            addChipGrid(keyCard, RemoteKeyPrefs.BUTTON_PRESETS);
            root.addView(keyCard);

            // Card 3: Hold threshold < 2s
            LinearLayout holdCard = makeCard();
            holdCard.addView(makeSectionTitle("3. Thời gian bấm giữ (< 2 giây)"));
            TextView holdNote = new TextView(ctx);
            holdNote.setText("Giữ đủ ngưỡng sẽ bật/tắt ngay Camera Popup. Nếu nút Remote chỉ phát 1 tín hiệu sau khi giữ, chọn 'Bấm 1 lần (0s)'.");
            holdNote.setTextColor(0xFF9FB0C4);
            holdNote.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
            holdNote.setPadding(0, 0, 0, dp(ctx, 8));
            holdCard.addView(holdNote);
            addHoldGrid(holdCard);
            root.addView(holdCard);

            // Card 4: Live Test Camera Popup Toggle
            Button testBtn = new Button(ctx);
            testBtn.setText("📷 Bấm thử bật / tắt Camera Popup ngay");
            testBtn.setAllCaps(false);
            testBtn.setTextColor(Color.WHITE);
            testBtn.setBackground(roundRectStatic(ctx, 0xFF196C2E, 0xFF2EA043, dp(ctx, 10)));
            testBtn.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    RemoteKeyAccessibilityService.invokeToggleCameraPopup(ctx);
                }
            });
            LinearLayout.LayoutParams testLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            testLp.topMargin = dp(ctx, 2);
            root.addView(testBtn, testLp);

            refreshUi();
            return scroll;
        }

        public void onResume() {
            RemoteKeyAccessibilityService.setDiagnosticListener(new RemoteKeyAccessibilityService.KeyDiagnosticListener() {
                @Override
                public void onKeyObserved(int keyCode, String deviceName, boolean learned) {
                    if (learned) {
                        onLearnedKey(keyCode);
                    } else {
                        refreshUi();
                    }
                }
            });
            refreshUi();
        }

        public void onPause() {
            RemoteKeyAccessibilityService.setDiagnosticListener(null);
            stopLearnMode();
        }

        public boolean onDirectKeyEvent(KeyEvent event) {
            if (event == null) return false;
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                int code = event.getKeyCode();
                if (RemoteKeyShortcutEngine.isSafeMappableKey(code)) {
                    RemoteKeyPrefs.recordLastKey(
                        ctx,
                        code,
                        event.getDevice() != null ? event.getDevice().getName() : "Direct",
                        System.currentTimeMillis()
                    );
                    if (learning) {
                        onLearnedKey(code);
                        return true;
                    }
                    refreshUi();
                }
            }
            return false;
        }

        private void startLearnMode() {
            learning = true;
            RemoteKeyAccessibilityService.startLearn(ctx, new RemoteKeyShortcutEngine.LearnCallback() {
                @Override
                public void onKeyCaptured(int keyCode) {
                    onLearnedKey(keyCode);
                }
            });
            try {
                releaseLearnSession();
                MediaSession ms = new MediaSession(ctx, "UltraCarLearn");
                ms.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
                PlaybackState ps = new PlaybackState.Builder()
                    .setActions(PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP)
                    .setState(PlaybackState.STATE_PAUSED, 0L, 1.0f)
                    .build();
                ms.setPlaybackState(ps);
                ms.setCallback(new MediaSession.Callback() {
                    @Override
                    public boolean onMediaButtonEvent(Intent mediaButtonIntent) {
                        if (!learning || mediaButtonIntent == null) return false;
                        KeyEvent ev = mediaButtonIntent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                        if (ev != null && ev.getAction() == KeyEvent.ACTION_DOWN
                                && RemoteKeyShortcutEngine.isSafeMappableKey(ev.getKeyCode())) {
                            RemoteKeyPrefs.recordLastKey(
                                ctx,
                                ev.getKeyCode(),
                                ev.getDevice() != null ? ev.getDevice().getName() : "MediaSession BT",
                                System.currentTimeMillis()
                            );
                            onLearnedKey(ev.getKeyCode());
                            return true;
                        }
                        return true;
                    }
                });
                ms.setActive(true);
                learnMediaSession = ms;
            } catch (Throwable ignored) {
            }
            refreshUi();
        }

        private void stopLearnMode() {
            learning = false;
            RemoteKeyAccessibilityService.stopLearn(ctx);
            releaseLearnSession();
            refreshUi();
        }

        private void releaseLearnSession() {
            if (learnMediaSession != null) {
                try {
                    learnMediaSession.setActive(false);
                    learnMediaSession.release();
                } catch (Throwable ignored) {
                }
                learnMediaSession = null;
            }
        }

        private void onLearnedKey(int keyCode) {
            learning = false;
            releaseLearnSession();
            RemoteKeyPrefs.setKeyCode(ctx, keyCode);
            RemoteKeyPrefs.setEnabled(ctx, true);
            RemoteKeyAccessibilityService.syncFromPrefs(ctx);
            Toast.makeText(
                ctx.getApplicationContext(),
                "Đã gán nút: " + RemoteKeyShortcutEngine.formatKeyName(keyCode),
                Toast.LENGTH_SHORT
            ).show();
            refreshUi();
        }

        private void refreshUi() {
            if (accStatusBadge == null) return;
            boolean accOk = RemoteKeyAccessibilityService.isAccessibilityEnabled(ctx);
            if (accOk) {
                accStatusBadge.setText("● ĐANG BẬT — Hoạt động trên mọi màn hình (DeX / Vietmap)");
                accStatusBadge.setTextColor(0xFF7EE787);
                accStatusBadge.setBackground(roundRectStatic(ctx, 0xFF102A1B, 0xFF2EA043, dp(ctx, 8)));
                accHintText.setText("Mở lại bảng này bất cứ lúc nào từ nút 🎛 Remote BT hoặc dấu + thanh nổi.");
                accEnableBtn.setVisibility(View.GONE);
            } else {
                accStatusBadge.setText("○ CHƯA BẬT quyền Trợ năng UltraCar");
                accStatusBadge.setTextColor(0xFFFFD166);
                accStatusBadge.setBackground(roundRectStatic(ctx, 0xFF2C220D, 0xFFD29922, dp(ctx, 8)));
                accHintText.setText("Bấm nút dưới → 'Ứng dụng đã cài đặt' → 'UltraCar — Phím tắt Remote BT' → BẬT.");
                accEnableBtn.setVisibility(View.VISIBLE);
            }

            enableSwitch.setChecked(RemoteKeyPrefs.isEnabled(ctx));
            int currentCode = RemoteKeyPrefs.getKeyCode(ctx);
            long currentHold = RemoteKeyPrefs.getHoldMs(ctx);
            selectedKeyBadge.setText("Nút đang gán: " + RemoteKeyShortcutEngine.formatKeyName(currentCode) + " (code=" + currentCode + ")");
            lastKeyText.setText(RemoteKeyPrefs.getLastKeySummary(ctx));

            int lastObserved = RemoteKeyPrefs.getLastObservedKeyCode(ctx);
            if (RemoteKeyShortcutEngine.isSafeMappableKey(lastObserved) && lastObserved != currentCode) {
                useLastKeyBtn.setText("⚡ Dùng ngay phím vừa bấm (" + RemoteKeyShortcutEngine.formatKeyName(lastObserved) + ")");
                useLastKeyBtn.setVisibility(View.VISIBLE);
            } else {
                useLastKeyBtn.setVisibility(View.GONE);
            }

            if (learning) {
                learnBtn.setText("⏳ ĐANG CHỜ... HÃY BẤM 1 NÚT TRÊN REMOTE (Bấm lại để huỷ)");
                learnBtn.setBackground(roundRectStatic(ctx, 0xFF9E4700, 0xFFF0883E, dp(ctx, 10)));
            } else {
                learnBtn.setText("🎯 HỌC PHÍM TỪ REMOTE BLUETOOTH");
                learnBtn.setBackground(roundRectStatic(ctx, 0xFF213148, 0xFF4F6D93, dp(ctx, 10)));
            }

            for (PresetChip chip : keyChips) {
                boolean sel = chip.keyCode == currentCode;
                chip.view.setBackground(roundRectStatic(ctx, sel ? 0xFF1A4B2E : 0xFF1C2736, sel ? 0xFF3FB950 : 0xFF35455C, dp(ctx, 8)));
                chip.view.setTextColor(sel ? 0xFFFFFFFF : 0xFFC9D5E3);
            }

            for (HoldChip chip : holdChips) {
                boolean sel = chip.holdMs == currentHold;
                chip.view.setBackground(roundRectStatic(ctx, sel ? 0xFF183C6E : 0xFF1C2736, sel ? 0xFF58A6FF : 0xFF35455C, dp(ctx, 8)));
                chip.view.setTextColor(sel ? 0xFFFFFFFF : 0xFFC9D5E3);
            }
        }

        private void addChipGrid(LinearLayout parent, RemoteKeyPrefs.Preset[] presets) {
            int cols = 3;
            for (int i = 0; i < presets.length; i += cols) {
                LinearLayout row = new LinearLayout(ctx);
                row.setOrientation(LinearLayout.HORIZONTAL);
                LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                rlp.bottomMargin = dp(ctx, 6);
                for (int j = 0; j < cols; j++) {
                    int idx = i + j;
                    if (idx >= presets.length) break;
                    final RemoteKeyPrefs.Preset p = presets[idx];
                    TextView tv = makeChip(p.shortLabel);
                    tv.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            learning = false;
                            releaseLearnSession();
                            RemoteKeyPrefs.setKeyCode(ctx, p.keyCode);
                            RemoteKeyPrefs.setEnabled(ctx, true);
                            RemoteKeyAccessibilityService.syncFromPrefs(ctx);
                            refreshUi();
                        }
                    });
                    keyChips.add(new PresetChip(p.keyCode, tv));
                    LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                    if (j > 0) clp.leftMargin = dp(ctx, 6);
                    row.addView(tv, clp);
                }
                parent.addView(row, rlp);
            }
        }

        private void addHoldGrid(LinearLayout parent) {
            long[] vals = RemoteKeyPrefs.HOLD_PRESETS_MS;
            int cols = 3;
            for (int i = 0; i < vals.length; i += cols) {
                LinearLayout row = new LinearLayout(ctx);
                row.setOrientation(LinearLayout.HORIZONTAL);
                LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
                rlp.bottomMargin = dp(ctx, 6);
                for (int j = 0; j < cols; j++) {
                    int idx = i + j;
                    if (idx >= vals.length) break;
                    final long ms = vals[idx];
                    TextView tv = makeChip(RemoteKeyPrefs.formatHoldLabel(ms));
                    tv.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            RemoteKeyPrefs.setHoldMs(ctx, ms);
                            RemoteKeyAccessibilityService.syncFromPrefs(ctx);
                            refreshUi();
                        }
                    });
                    holdChips.add(new HoldChip(ms, tv));
                    LinearLayout.LayoutParams clp = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
                    if (j > 0) clp.leftMargin = dp(ctx, 6);
                    row.addView(tv, clp);
                }
                parent.addView(row, rlp);
            }
        }

        private LinearLayout makeCard() {
            LinearLayout card = new LinearLayout(ctx);
            card.setOrientation(LinearLayout.VERTICAL);
            int p = dp(ctx, 12);
            card.setPadding(p, p, p, p);
            card.setBackground(roundRectStatic(ctx, 0xFF141E2B, 0xFF28364A, dp(ctx, 12)));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = dp(ctx, 10);
            card.setLayoutParams(lp);
            return card;
        }

        private TextView makeSectionTitle(String text) {
            TextView tv = new TextView(ctx);
            tv.setText(text);
            tv.setTextColor(0xFFEAF1F8);
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            tv.setTypeface(null, Typeface.BOLD);
            tv.setPadding(0, 0, 0, dp(ctx, 6));
            return tv;
        }

        private TextView makeChip(String text) {
            TextView tv = new TextView(ctx);
            tv.setText(text);
            tv.setGravity(Gravity.CENTER);
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f);
            tv.setTypeface(null, Typeface.BOLD);
            tv.setPadding(dp(ctx, 4), dp(ctx, 9), dp(ctx, 4), dp(ctx, 9));
            return tv;
        }

        private TextView makePill(String text, int bg, int fg) {
            TextView tv = new TextView(ctx);
            tv.setText(text);
            tv.setTextColor(fg);
            tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12.5f);
            tv.setTypeface(null, Typeface.BOLD);
            tv.setPadding(dp(ctx, 10), dp(ctx, 5), dp(ctx, 10), dp(ctx, 5));
            tv.setBackground(roundRectStatic(ctx, bg, 0xFF3E4F66, dp(ctx, 14)));
            return tv;
        }
    }

    private static GradientDrawable roundRectStatic(Context ctx, int fill, int stroke, int radiusPx) {
        GradientDrawable gd = new GradientDrawable();
        gd.setColor(fill);
        gd.setCornerRadius(radiusPx);
        gd.setStroke(dp(ctx, 1), stroke);
        return gd;
    }

    private static int dp(Context ctx, int v) {
        return (int) (v * ctx.getResources().getDisplayMetrics().density + 0.5f);
    }
}
