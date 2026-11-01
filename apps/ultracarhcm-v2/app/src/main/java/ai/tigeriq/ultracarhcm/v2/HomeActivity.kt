package ai.tigeriq.ultracarhcm.v2

import android.app.AlertDialog
import android.net.Uri
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.provider.Settings
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.VideoView
import android.widget.TextView
import android.widget.EditText
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.platform.ComposeView
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Faithful-image HOME reconstruction prototype using the actual source APK assets.
 * Original APP is the UI authority. V2 feature parity is NOT implied by this screen.
 */
class HomeActivity : ComponentActivity() {
    private lateinit var root: FrameLayout
    private val prefs by lazy { getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE) }
    private val tickHandler = Handler(Looper.getMainLooper())
    private var clock: TextView? = null
    private var homeVideo: VideoView? = null
    private var customBackgroundVideo: VideoView? = null
    private var homeVisible = false
    private val accent = Color.rgb(0, 208, 255)
    private val clockTick = object : Runnable {
        override fun run() {
            clock?.text = SimpleDateFormat("EEEE\ndd/MM\nHH:mm", Locale("vi", "VN")).format(Date())
            tickHandler.postDelayed(this, 1000L)
        }
    }
    private val exportBackupLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("application/json"),
    ) { uri ->
        if (uri != null) writeHomeBackup(uri)
    }
    private val importBackupLauncher = registerForActivityResult(
        ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) readHomeBackup(uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        window.setFlags(1024, 1024)
        root = FrameLayout(this)
        setContentView(root)
        applyDefaultHomeConfiguration()
        // onResume owns UI playback/ticks; queued draws must not start while stopped.
        root.post { if (homeVisible && homeVideo == null) render() }
    }

    override fun onResume() {
        super.onResume()
        homeVisible = true
        tickHandler.removeCallbacks(clockTick)
        tickHandler.post(clockTick)
        root.post { if (homeVisible && homeVideo == null) render() }
        if (DexUtils.isDesktop(this) && Settings.canDrawOverlays(this)) {
            try {
                startService(Intent(this, OverlayService::class.java)
                    .putExtra("displayId", requestedCameraDisplayId()))
            } catch (t: Throwable) {
                android.util.Log.e("UltraCarV2", "DeX floating Camera service start failed", t)
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        root.post { if (homeVisible) render() }
    }

    override fun onStop() {
        // Stop hardware decoding and ticking while HOME is no longer visible.
        // A later onResume recreates only this V2-owned video; never touches V1.
        homeVisible = false
        tickHandler.removeCallbacks(clockTick)
        releaseHomeVideo()
        super.onStop()
    }

    override fun onDestroy() {
        homeVisible = false
        tickHandler.removeCallbacks(clockTick)
        releaseHomeVideo()
        super.onDestroy()
    }

    // Recreating HOME must release the old decoder rather than just detach its view.
    private fun releaseHomeVideo() {
        homeVideo?.let { video ->
            video.setOnPreparedListener(null)
            video.setOnErrorListener(null)
            video.stopPlayback()
        }
        homeVideo = null
        customBackgroundVideo?.let { video ->
            video.setOnPreparedListener(null)
            video.setOnErrorListener(null)
            video.stopPlayback()
        }
        customBackgroundVideo = null
    }

    private fun clearInvalidCustomBackground() {
        val cleared = prefs.edit()
            .remove(AppearanceRules.PREF_CUSTOM_BACKGROUND_URI)
            .remove(AppearanceRules.PREF_CUSTOM_BACKGROUND_KIND)
            .commit()
        if (!cleared) {
            android.util.Log.e(
                "UltraCarV2",
                "Failed to persist invalid custom background cleanup",
            )
        }
    }

    private fun renderBackground(night: Boolean) {
        val uriText = prefs.getString(AppearanceRules.PREF_CUSTOM_BACKGROUND_URI, null)
        val kind = prefs.getString(AppearanceRules.PREF_CUSTOM_BACKGROUND_KIND, null)
        if (uriText.isNullOrBlank() || !AppearanceRules.isSupportedKind(kind)) {
            image(
                if (night) R.drawable.v2_road_city_night else R.drawable.v2_road_city_day,
                0f, 0f, 1f, 1f, ImageView.ScaleType.FIT_XY,
            )
            return
        }

        val uri = runCatching { Uri.parse(uriText) }.getOrNull()
        if (uri == null) {
            clearInvalidCustomBackground()
            image(
                if (night) R.drawable.v2_road_city_night else R.drawable.v2_road_city_day,
                0f, 0f, 1f, 1f, ImageView.ScaleType.FIT_XY,
            )
            return
        }

        when (kind) {
            AppearanceRules.KIND_IMAGE -> {
                try {
                    ImageView(this).also { view ->
                        view.scaleType = ImageView.ScaleType.CENTER_CROP
                        view.setImageURI(uri)
                        place(view, 0f, 0f, 1f, 1f)
                    }
                } catch (error: SecurityException) {
                    android.util.Log.e("UltraCarV2", "Custom image permission lost", error)
                    clearInvalidCustomBackground()
                    image(
                        if (night) R.drawable.v2_road_city_night else R.drawable.v2_road_city_day,
                        0f, 0f, 1f, 1f, ImageView.ScaleType.FIT_XY,
                    )
                }
            }
            AppearanceRules.KIND_VIDEO -> {
                val video = VideoView(this)
                customBackgroundVideo = video
                video.setVideoURI(uri)
                video.setOnPreparedListener { player ->
                    if (customBackgroundVideo === video) {
                        player.isLooping = true
                        player.setVolume(0f, 0f)
                        if (homeVisible) video.start()
                    }
                }
                video.setOnErrorListener { _, _, _ ->
                    if (customBackgroundVideo === video) {
                        clearInvalidCustomBackground()
                        customBackgroundVideo = null
                        root.post { if (homeVisible) render() }
                    }
                    true
                }
                place(video, 0f, 0f, 1f, 1f)
            }
        }
    }

    // DisplayManager APIs work back to minSdk 26; Activity.getDisplay() requires API 30.
    private fun requestedCameraDisplayId(): Int =
        DexUtils.resolveDisplay(this, 0)?.displayId ?: 0

    private fun shape(fill: Int, stroke: Int = Color.TRANSPARENT, radius: Float = 16f): GradientDrawable {
        return GradientDrawable().apply {
            setColor(fill)
            cornerRadius = radius * resources.displayMetrics.density
            if (stroke != Color.TRANSPARENT) setStroke(dp(2), stroke)
        }
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density + 0.5f).toInt()

    private fun place(view: View, left: Float, top: Float, width: Float, height: Float) {
        val w = root.width
        val h = root.height
        val lp = FrameLayout.LayoutParams((w * width).toInt(), (h * height).toInt())
        lp.leftMargin = (w * left).toInt()
        lp.topMargin = (h * top).toInt()
        root.addView(view, lp)
    }

    private fun image(res: Int, left: Float, top: Float, width: Float, height: Float,
                      scale: ImageView.ScaleType = ImageView.ScaleType.FIT_CENTER): ImageView {
        val v = ImageView(this)
        v.setImageResource(res)
        v.scaleType = scale
        place(v, left, top, width, height)
        return v
    }

    private fun label(value: String, textSize: Float, color: Int = Color.WHITE,
                      strong: Boolean = false, centered: Boolean = true): TextView {
        return TextView(this).apply {
            text = value
            setTextSize(textSize)
            setTextColor(color)
            gravity = if (centered) Gravity.CENTER else Gravity.CENTER_VERTICAL
            if (strong) setTypeface(null, Typeface.BOLD)
            includeFontPadding = false
        }
    }

    private fun button(
        value: String,
        left: Float,
        top: Float,
        width: Float,
        height: Float,
        outline: Boolean = true,
        onLongClick: (() -> Unit)? = null,
        onClick: () -> Unit,
    ) {
        val v = label(value, if (width > .30f) 18f else 13f, accent, true)
        v.background = shape(
            if (outline) 0x860a141a.toInt() else 0x9a132631.toInt(),
            if (outline) accent else Color.TRANSPARENT,
            16f,
        )
        v.isClickable = true
        v.contentDescription = value
        v.setOnClickListener { onClick() }
        if (onLongClick != null) {
            // Android's long-click gesture uses the platform long-press timeout (~500 ms).
            v.isLongClickable = true
            v.setOnLongClickListener {
                onLongClick()
                true
            }
        }
        place(v, left, top, width, height)
    }

    private fun quickSlots(): JSONArray {
        val stored = try {
            JSONArray(prefs.getString("v2_quick_slots", "[]") ?: "[]")
        } catch (e: Exception) {
            android.util.Log.w("UltraCarV2", "Corrupt quick-slot state", e)
            JSONArray()
        }
        val normalized = JSONArray()
        for (index in 0 until QuickSlotRules.SLOT_COUNT) {
            val item = stored.optJSONObject(index)
            normalized.put(
                JSONObject()
                    .put("label", item?.optString("label", "") ?: "")
                    .put("target", item?.optString("target", "") ?: ""),
            )
        }
        return normalized
    }

    private fun saveQuickSlot(index: Int, label: String, target: String) {
        if (index !in 0 until QuickSlotRules.SLOT_COUNT) return
        val slots = quickSlots()
        slots.put(
            index,
            JSONObject()
                .put("label", QuickSlotRules.normalizeLabel(label))
                .put("target", QuickSlotRules.normalizeTarget(target)),
        )
        val saved = prefs.edit()
            .putString("v2_quick_slots", slots.toString())
            .commit()
        if (!saved) {
            toast("Không thể lưu phím tắt trên thiết bị")
            return
        }
        render()
    }

    private fun clearQuickSlot(index: Int) = saveQuickSlot(index, "", "")

    private fun launchQuickSlot(slot: JSONObject) {
        val label = slot.optString("label", "Ứng dụng")
        val target = slot.optString("target", "").trim()
        when {
            target.isEmpty() -> toast("Bấm giữ ô để gán ứng dụng")
            target == QuickSlotRules.CAMERA_TARGET ->
                startActivity(Intent(this, UsbCameraActivity::class.java))
            else -> {
                val launch = packageManager.getLaunchIntentForPackage(target)
                if (launch == null) {
                    toast("Chưa tìm thấy ứng dụng: $label")
                } else {
                    startActivity(launch)
                }
            }
        }
    }

    private fun showCustomQuickSlotEditor(index: Int) {
        val input = EditText(this).apply {
            setSingleLine(true)
            hint = "Tên ứng dụng | com.example.app"
        }
        AlertDialog.Builder(this)
            .setTitle("Gán ứng dụng cho ô ${index + 1}")
            .setMessage("Nhập tên hiển thị và package Android, ngăn cách bằng dấu |.")
            .setView(input)
            .setNegativeButton("Hủy", null)
            .setPositiveButton("Gán") { _, _ ->
                val assignment = QuickSlotRules.parseCustomAssignment(input.text.toString())
                if (assignment == null) {
                    toast("Định dạng không hợp lệ")
                } else {
                    saveQuickSlot(index, assignment.label, assignment.target)
                }
            }
            .show()
    }

    private fun showQuickSlotEditor(index: Int) {
        val actions = arrayOf(
            "— Bỏ gán ô này —",
            "YouTube",
            "Zing MP3",
            "Spotify",
            "Google Maps",
            "Camera USB",
            "Nhập ứng dụng khác…",
        )
        AlertDialog.Builder(this)
            .setTitle("Phím tắt ${index + 1}")
            .setItems(actions) { _, which ->
                when (which) {
                    0 -> clearQuickSlot(index)
                    1 -> saveQuickSlot(index, "YouTube", "com.google.android.youtube")
                    2 -> saveQuickSlot(index, "Zing MP3", "com.zing.mp3")
                    3 -> saveQuickSlot(index, "Spotify", "com.spotify.music")
                    4 -> saveQuickSlot(index, "Google Maps", "com.google.android.apps.maps")
                    5 -> saveQuickSlot(index, "Camera USB", QuickSlotRules.CAMERA_TARGET)
                    6 -> showCustomQuickSlotEditor(index)
                }
            }
            .setNegativeButton("Đóng", null)
            .show()
    }

    private fun renderQuickBar(): Float {
        val slots = quickSlots()
        val models = (0 until QuickSlotRules.SLOT_COUNT).map { index ->
            val slot = slots.optJSONObject(index) ?: JSONObject()
            val label = slot.optString("label", "")
            val target = slot.optString("target", "")
            QuickSlotUi(
                index = index,
                label = label,
                icon = QuickSlotRules.iconFor(label, target),
            )
        }

        // V1.0.64 lifted the three-row shortcut cluster by 50dp toward the vehicle tail.
        val baselineTopPx = root.height * .69f
        val liftedTop = ((baselineTopPx - dp(50)).coerceAtLeast(root.height * .56f)) / root.height
        val quickBar = ComposeView(this).apply {
            setContent {
                MaterialTheme {
                    QuickBarGrid(
                        slots = models,
                        onClick = { index ->
                            val slot = slots.optJSONObject(index) ?: JSONObject()
                            launchQuickSlot(slot)
                        },
                        onLongClick = { index -> showQuickSlotEditor(index) },
                    )
                }
            }
        }
        val quickBarHeight = .145f
        place(quickBar, .045f, liftedTop, .91f, quickBarHeight)
        return liftedTop + quickBarHeight
    }

    private fun renderNarrowDexPanel() {
        val night = prefs.getBoolean("night", false)
        renderBackground(night)

        val shade = label("", 10f)
        shade.background = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(0x10000000, 0x26000000, 0x90000000.toInt()),
        )
        place(shade, 0f, 0f, 1f, 1f)

        image(R.drawable.v2_logo_ultracar, .08f, .025f, .84f, .12f)

        clock = label("", 13f, Color.WHITE, true).apply {
            background = shape(0x800c1a22.toInt(), radius = 8f)
        }
        place(clock!!, .08f, .17f, .84f, .09f)
        clock?.text = SimpleDateFormat("EEEE\ndd/MM\nHH:mm", Locale("vi", "VN")).format(Date())

        button("GOOGLE MAPS", .08f, .285f, .84f, .065f) {
            launchQuickSlot(
                JSONObject()
                    .put("label", "Google Maps")
                    .put("target", "com.google.android.apps.maps"),
            )
        }
        button("CAMERA USB", .08f, .37f, .84f, .065f) {
            startActivity(Intent(this, UsbCameraActivity::class.java))
        }
        button("CÀI ĐẶT", .08f, .455f, .84f, .065f) {
            showSettings()
        }

        val vehicleModel = VehicleRules.currentModel(
            prefs.getString(VehicleRules.PREF_MODEL, null),
            prefs.getBoolean("limo", false),
        )
        image(
            if (vehicleModel == VehicleRules.MODEL_LIMO_RED) R.drawable.v2_car_limo_do_parked
            else R.drawable.v2_car_lambogini_trang_parked,
            .18f, .56f, .64f, .20f,
        )

        val plate = prefs.getString(VehicleRules.PREF_LICENSE_PLATE, "")
            ?.takeIf { it.isNotBlank() }
        if (plate != null) {
            place(
                label(plate, 12f, Color.WHITE, true).apply {
                    background = shape(0xb8101a20.toInt(), radius = 8f)
                },
                .20f, .755f, .60f, .038f,
            )
        }

        button("LÀM MỚI", .08f, .825f, .84f, .06f) { render() }
        place(
            label("DeX panel • V2 • chưa tự sắp cửa sổ", 8f, 0xffbbbbbb.toInt()),
            .04f, .93f, .92f, .025f,
        )
    }

    private fun render() {
        if (root.width == 0 || root.height == 0) return
        releaseHomeVideo()
        root.removeAllViews()
        if (
            HomeLayoutRules.useNarrowDexPanel(
                widthPx = root.width,
                heightPx = root.height,
                density = resources.displayMetrics.density,
                isDesktop = DexUtils.isDesktop(this),
            )
        ) {
            renderNarrowDexPanel()
            return
        }
        val night = prefs.getBoolean("night", false)
        renderBackground(night)
        val bg = label("", 10f)
        bg.background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(0x12000000, 0x00000000, 0x28000000, 0xa2000000.toInt()))
        place(bg, 0f, 0f, 1f, 1f)

        image(R.drawable.v2_logo_ultracar, .30f, .045f, .40f, .145f)
        val gear = label("⚙", 35f, Color.rgb(35,45,55), true)
        gear.background = shape(0xeaeff3f5.toInt(), radius = 100f)
        gear.isClickable = true
        gear.contentDescription = "Cài đặt"
        gear.setOnClickListener { showSettings() }
        place(gear, .81f, .060f, .13f, .064f)

        val name = prefs.getString("driver_name", "Driver") ?: "Driver"
        place(label("Welcome back", 14f, 0xffdddddd.toInt()), .20f, .185f, .60f, .024f)
        place(label(name, 31f, Color.WHITE, true), .17f, .214f, .66f, .038f)
        button("⚑  RACING", .37f, .268f, .26f, .038f) {
            toast("Chế độ RACING V2 chưa hoàn tất — đang giữ giao diện chuẩn")
        }
        clock = label("", 16f, Color.WHITE, true).apply {
            background = shape(0x800c1a22.toInt(), radius=8f)
        }
        place(clock!!, .026f, .334f, .22f, .074f)
        clock?.text = SimpleDateFormat("EEEE\ndd/MM\nHH:mm", Locale("vi", "VN")).format(Date())

        val vehicleModel = VehicleRules.currentModel(
            prefs.getString(VehicleRules.PREF_MODEL, null),
            prefs.getBoolean("limo", false),
        )
        image(
            if (vehicleModel == VehicleRules.MODEL_LIMO_RED) R.drawable.v2_car_limo_do_parked
            else R.drawable.v2_car_lambogini_trang_parked,
            .295f, .458f, .41f, .242f,
        )
        val plate = prefs.getString(VehicleRules.PREF_LICENSE_PLATE, "")
            ?.takeIf { it.isNotBlank() }
        if (plate != null) {
            place(
                label(plate, 14f, Color.WHITE, true).apply {
                    background = shape(0xb8101a20.toInt(), radius = 8f)
                },
                .375f, .665f, .25f, .034f,
            )
        }

        val quickBarBottom = renderQuickBar()
        val startTop = maxOf(.73f, quickBarBottom + .006f).coerceAtMost(.80f)

        button("KHỞI ĐỘNG", .028f, startTop, .79f, .043f) {
            AlertDialog.Builder(this).setTitle("Chưa nghiệm thu chức năng Khởi động")
                .setMessage("V2 đang được tái dựng từ ứng dụng chuẩn. Tính năng Khởi động và bố cục đa cửa sổ chưa tương đương. Không chuyển sang giao diện demo.")
                .setPositiveButton("Đóng", null).show()
        }
        button("⟳", .835f, startTop, .137f, .043f) { render() }
        val shortcutTop = (startTop + .049f).coerceAtMost(.849f)
        renderSavedLayoutShortcuts(shortcutTop)

        val bottomShade = label("", 10f)
        bottomShade.background = shape(0x7d000000, radius=12f)
        place(bottomShade, .028f, .883f, .944f, .074f)
        button("▣\nCấu hình đã lưu", .045f, .890f, .29f, .055f, false) { showSaved() }
        button("+\nLưu cấu hình", .357f, .890f, .29f, .055f, false) { saveHomeConfiguration() }
        val bot = VideoView(this)
        homeVideo = bot
        bot.setVideoURI(Uri.parse("android.resource://$packageName/${R.raw.ultrabot_glow_packed}"))
        bot.setOnPreparedListener { mp ->
            if (homeVideo === bot) {
                mp.isLooping = true
                mp.setVolume(0f, 0f)
                bot.start()
            }
        }
        bot.setOnErrorListener { _, _, _ -> true }
        place(bot, .675f, .887f, .278f, .062f)
        bot.setOnClickListener { toast("Ultrabot V2 chưa tích hợp — không đổi nút này thành Camera") }
        val footer = label("UltraCarHCM V2 • DEVELOPMENT • CHƯA NGHIỆM THU", 9f, 0xffbbbbbb.toInt())
        place(footer, .02f, .972f, .96f, .016f)
    }

    // Real, device-local HOME snapshots only. These are not V1 layout parity.
    private fun savedConfigurations(): JSONArray {
        val raw = try {
            JSONArray(prefs.getString("v2_home_configs", "[]") ?: "[]")
        } catch (e: Exception) {
            android.util.Log.w("UltraCarV2", "Corrupt local HOME config", e)
            val cleared = prefs.edit().remove("v2_home_configs").commit()
            if (!cleared) {
                android.util.Log.e(
                    "UltraCarV2",
                    "Failed to persist corrupt HOME config cleanup",
                )
            }
            return JSONArray()
        }
        val normalized = JSONArray()
        val seenIds = mutableSetOf<String>()
        val limit = minOf(raw.length(), HomeConfigRules.MAX_SAVED)
        for (index in 0 until limit) {
            val item = raw.optJSONObject(index) ?: continue
            val safe = normalizeHomeConfiguration(item) ?: continue
            var configId = SavedLayoutShortcutRules.normalizeConfigId(
                safe.optString("configId", ""),
            )
            if (!SavedLayoutShortcutRules.validConfigId(configId) || !seenIds.add(configId)) {
                do {
                    configId = SavedLayoutShortcutRules.freshConfigId()
                } while (!seenIds.add(configId))
            }
            safe.put("configId", configId)
            normalized.put(safe)
        }
        if (normalized.toString() != raw.toString()) {
            val persisted = prefs.edit()
                .putString("v2_home_configs", normalized.toString())
                .commit()
            if (!persisted) {
                android.util.Log.e(
                    "UltraCarV2",
                    "Failed to persist normalized HOME configurations",
                )
            }
        }
        return normalized
    }

    private fun savedLayoutShortcutPrefs() =
        getSharedPreferences(SavedLayoutShortcutRules.PREFS_NAME, Context.MODE_PRIVATE)

    private fun savedLayoutShortcutConfigId(index: Int): String? {
        val key = SavedLayoutShortcutRules.slotKey(index) ?: return null
        val prefs = savedLayoutShortcutPrefs()
        val raw = prefs.getString(key, null) ?: return null
        val configId = SavedLayoutShortcutRules.normalizeConfigId(raw)
        if (!SavedLayoutShortcutRules.validConfigId(configId)) {
            prefs.edit().remove(key).commit()
            return null
        }
        return configId
    }

    private fun saveSavedLayoutShortcut(index: Int, configId: String?): Boolean {
        val key = SavedLayoutShortcutRules.slotKey(index) ?: return false
        val editor = savedLayoutShortcutPrefs().edit()
        if (configId == null) {
            editor.remove(key)
        } else {
            val safeId = SavedLayoutShortcutRules.normalizeConfigId(configId)
            if (!SavedLayoutShortcutRules.validConfigId(safeId)) return false
            editor.putString(key, safeId)
        }
        return editor.commit()
    }

    private fun clearSavedLayoutShortcutReferences(configId: String) {
        val safeId = SavedLayoutShortcutRules.normalizeConfigId(configId)
        if (!SavedLayoutShortcutRules.validConfigId(safeId)) return
        val shortcutPrefs = savedLayoutShortcutPrefs()
        val editor = shortcutPrefs.edit()
        var changed = false
        for (index in 0 until SavedLayoutShortcutRules.SLOT_COUNT) {
            val key = SavedLayoutShortcutRules.slotKey(index) ?: continue
            if (shortcutPrefs.getString(key, null) == safeId) {
                editor.remove(key)
                changed = true
            }
        }
        if (changed) editor.commit()
    }

    private fun savedConfigurationById(entries: JSONArray, configId: String): JSONObject? {
        for (index in 0 until entries.length()) {
            val item = entries.optJSONObject(index) ?: continue
            if (item.optString("configId", "") == configId) return item
        }
        return null
    }

    private fun showSavedLayoutShortcutEditor(index: Int) {
        if (SavedLayoutShortcutRules.slotKey(index) == null) return
        val entries = savedConfigurations()
        if (entries.length() == 0) {
            toast("Chưa có cấu hình Home để gán")
            return
        }
        val names = Array(entries.length()) { position ->
            entries.optJSONObject(position)?.optString("name", "Home ${position + 1}")
                ?: "Home ${position + 1}"
        }
        AlertDialog.Builder(this)
            .setTitle("Gán phím bố cục ${index + 1}")
            .setItems(names) { _, position ->
                val item = entries.optJSONObject(position) ?: return@setItems
                val configId = item.optString("configId", "")
                if (saveSavedLayoutShortcut(index, configId)) {
                    toast("Đã gán ${names[position]}")
                    render()
                } else {
                    toast("Không thể lưu phím bố cục")
                }
            }
            .setNeutralButton("Bỏ gán") { _, _ ->
                if (saveSavedLayoutShortcut(index, null)) {
                    toast("Đã bỏ gán phím bố cục")
                    render()
                } else {
                    toast("Không thể bỏ gán phím bố cục")
                }
            }
            .setNegativeButton("Đóng", null)
            .show()
    }

    private fun openSavedLayoutShortcut(index: Int) {
        val configId = savedLayoutShortcutConfigId(index)
        if (configId == null) {
            showSavedLayoutShortcutEditor(index)
            return
        }
        val entries = savedConfigurations()
        val item = savedConfigurationById(entries, configId)
        if (item == null) {
            saveSavedLayoutShortcut(index, null)
            toast("Bố cục đã gán không còn tồn tại")
            render()
            return
        }
        if (applyHomeConfiguration(item, true)) {
            toast("Đã mở ${item.optString("name", "Home")}")
        } else {
            toast("Cấu hình Home không tương thích")
        }
    }

    private fun renderSavedLayoutShortcuts(top: Float) {
        val entries = savedConfigurations()
        for (index in 0 until SavedLayoutShortcutRules.SLOT_COUNT) {
            val configId = savedLayoutShortcutConfigId(index)
            val item = configId?.let { savedConfigurationById(entries, it) }
            if (configId != null && item == null) saveSavedLayoutShortcut(index, null)
            val title = item?.optString("name", "")
                ?.takeIf { it.isNotBlank() }
                ?.take(12)
                ?: String.format(Locale.US, "+%02d", index + 1)
            val left = .05f + index * .1825f
            button(
                title,
                left,
                top,
                .17f,
                .036f,
                outline = false,
                onLongClick = { showSavedLayoutShortcutEditor(index) },
            ) {
                openSavedLayoutShortcut(index)
            }
        }
    }

    private fun normalizedQuickSlotsForStorage(source: JSONArray?): JSONArray {
        val normalized = JSONArray()
        for (index in 0 until QuickSlotRules.SLOT_COUNT) {
            val item = source?.optJSONObject(index)
            normalized.put(
                JSONObject()
                    .put("label", QuickSlotRules.normalizeLabel(item?.optString("label", "") ?: ""))
                    .put("target", QuickSlotRules.normalizeTarget(item?.optString("target", "") ?: "")),
            )
        }
        return normalized
    }

    private fun validatedQuickSlotsForBackup(source: JSONArray?): JSONArray? {
        if (source == null || source.length() != QuickSlotRules.SLOT_COUNT) return null
        val normalized = JSONArray()
        for (index in 0 until QuickSlotRules.SLOT_COUNT) {
            val item = source.optJSONObject(index) ?: return null
            val rawLabel = item.opt("label")
            val rawTarget = item.opt("target")
            if (rawLabel !is String || rawTarget !is String) return null
            if (!QuickSlotRules.isValidPersistedAssignment(rawLabel, rawTarget)) return null
            normalized.put(
                JSONObject()
                    .put("label", QuickSlotRules.normalizeLabel(rawLabel))
                    .put("target", QuickSlotRules.normalizeTarget(rawTarget)),
            )
        }
        return normalized
    }

    private fun validatedHomeConfigurationForBackup(item: JSONObject): JSONObject? {
        val schema = if (item.has("schemaVersion")) {
            HomeBackupRules.exactInt(item.opt("schemaVersion")) ?: return null
        } else {
            0
        }
        if (!HomeConfigRules.canReadSchema(schema)) return null

        if (item.has("name") && HomeBackupRules.exactString(item.opt("name")) == null) return null
        if (item.has("configId")) {
            val rawConfigId = HomeBackupRules.exactString(item.opt("configId")) ?: return null
            if (!SavedLayoutShortcutRules.validConfigId(rawConfigId)) return null
        }
        if (item.has("driver") && HomeBackupRules.exactString(item.opt("driver")) == null) return null
        if (item.has("night") && HomeBackupRules.exactBoolean(item.opt("night")) == null) return null
        if (item.has("limo") && HomeBackupRules.exactBoolean(item.opt("limo")) == null) return null
        if (item.has("vehicleModel") &&
            HomeBackupRules.exactString(item.opt("vehicleModel")) == null
        ) return null
        if (item.has("licensePlate") &&
            HomeBackupRules.exactString(item.opt("licensePlate")) == null
        ) return null
        if (schema >= HomeConfigRules.CURRENT_SCHEMA_VERSION &&
            (!item.has("vehicleModel") || !item.has("licensePlate"))
        ) return null
        if (item.has("quickSlots") &&
            validatedQuickSlotsForBackup(item.optJSONArray("quickSlots")) == null
        ) return null

        return normalizeHomeConfiguration(item)
    }

    private fun normalizeHomeConfiguration(item: JSONObject): JSONObject? {
        val schema = item.optInt("schemaVersion", 0)
        if (!HomeConfigRules.canReadSchema(schema)) {
            android.util.Log.w("UltraCarV2", "Unsupported HOME config schema=$schema")
            return null
        }
        val name = HomeConfigRules.normalizeName(item.optString("name", "Home")).ifEmpty { "Home" }
        val driver = HomeConfigRules.normalizeName(item.optString("driver", "Driver")).ifEmpty { "Driver" }
        val legacyLimo = item.optBoolean("limo", false)
        val vehicleModel = VehicleRules.currentModel(
            item.optString("vehicleModel", ""),
            legacyLimo,
        )
        val licensePlate = VehicleRules.normalizeLicensePlate(
            item.optString("licensePlate", ""),
        )
        val configId = SavedLayoutShortcutRules.normalizeConfigId(
            item.optString("configId", ""),
        )
        return JSONObject()
            .put("schemaVersion", HomeConfigRules.CURRENT_SCHEMA_VERSION)
            .put("name", name)
            .also { normalized ->
                if (SavedLayoutShortcutRules.validConfigId(configId)) {
                    normalized.put("configId", configId)
                }
            }
            .put("night", item.optBoolean("night", false))
            .put("limo", vehicleModel == VehicleRules.MODEL_LIMO_RED)
            .put("vehicleModel", vehicleModel)
            .put("licensePlate", licensePlate)
            .put("driver", driver)
            .also { normalized ->
                if (item.has("quickSlots")) {
                    normalized.put(
                        "quickSlots",
                        normalizedQuickSlotsForStorage(item.optJSONArray("quickSlots")),
                    )
                }
            }
    }

    private fun applyHomeConfiguration(item: JSONObject, renderAfter: Boolean): Boolean {
        val safe = normalizeHomeConfiguration(item) ?: return false
        val editor = prefs.edit()
            .putBoolean("night", safe.optBoolean("night", false))
            .putBoolean("limo", safe.optBoolean("limo", false))
            .putString(VehicleRules.PREF_MODEL, safe.optString("vehicleModel"))
            .putString(VehicleRules.PREF_LICENSE_PLATE, safe.optString("licensePlate"))
            .putString("driver_name", safe.optString("driver", "Driver"))
        safe.optJSONArray("quickSlots")?.let { slots ->
            editor.putString("v2_quick_slots", normalizedQuickSlotsForStorage(slots).toString())
        }
        if (!editor.commit()) return false
        if (renderAfter) render()
        return true
    }

    private fun applyDefaultHomeConfiguration() {
        val raw = prefs.getString("v2_default_home_config", null) ?: return
        try {
            val item = JSONObject(raw)
            val safe = normalizeHomeConfiguration(item)
                ?: throw IllegalArgumentException("Unsupported HOME config schema")
            if (safe.toString() != item.toString()) {
                prefs.edit().putString("v2_default_home_config", safe.toString()).apply()
            }
            applyHomeConfiguration(safe, false)
        } catch (e: Exception) {
            android.util.Log.w("UltraCarV2", "Corrupt or unsupported default HOME configuration", e)
            prefs.edit().remove("v2_default_home_config").apply()
        }
    }

    private fun setDefaultHomeConfiguration(item: JSONObject) {
        val safe = normalizeHomeConfiguration(item)
        if (safe == null) {
            toast("Không thể đặt cấu hình không tương thích làm mặc định")
            return
        }
        if (prefs.edit().putString("v2_default_home_config", safe.toString()).commit()) {
            toast("Đã đặt cấu hình Home mặc định")
        } else {
            toast("Không thể lưu cấu hình Home mặc định")
        }
    }

    private fun saveHomeConfiguration() {
        val current = savedConfigurations()
        if (!HomeConfigRules.canSave(current.length())) {
            toast("Giới hạn 20 cấu hình Home trên thiết bị")
            return
        }
        val input = EditText(this).apply {
            setSingleLine(true)
            setText("Home ${current.length() + 1}")
            selectAll()
        }
        AlertDialog.Builder(this)
            .setTitle("Lưu cấu hình Home (chưa phải bố cục V1)")
            .setView(input)
            .setNegativeButton("Hủy", null)
            .setPositiveButton("Lưu") { _, _ ->
                val name = HomeConfigRules.normalizeName(input.text.toString())
                if (name.isEmpty()) {
                    toast("Cần nhập tên cấu hình")
                } else {
                    val selectedModel = VehicleRules.currentModel(
                        prefs.getString(VehicleRules.PREF_MODEL, null),
                        prefs.getBoolean("limo", false),
                    )
                    val licensePlate = VehicleRules.normalizeLicensePlate(
                        prefs.getString(VehicleRules.PREF_LICENSE_PLATE, "") ?: "",
                    )
                    current.put(JSONObject()
                        .put("schemaVersion", HomeConfigRules.CURRENT_SCHEMA_VERSION)
                        .put("configId", SavedLayoutShortcutRules.freshConfigId())
                        .put("name", name)
                        .put("night", prefs.getBoolean("night", false))
                        .put("limo", selectedModel == VehicleRules.MODEL_LIMO_RED)
                        .put("vehicleModel", selectedModel)
                        .put("licensePlate", licensePlate)
                        .put("driver", prefs.getString("driver_name", "Driver") ?: "Driver")
                        .put("quickSlots", normalizedQuickSlotsForStorage(quickSlots())))
                    if (prefs.edit().putString("v2_home_configs", current.toString()).commit()) {
                        toast("Đã lưu cấu hình Home trên thiết bị")
                    } else {
                        toast("Không thể lưu cấu hình Home")
                    }
                }
            }.show()
    }

    private fun moveSavedConfiguration(index: Int, delta: Int): Boolean {
        val entries = savedConfigurations()
        val target = HomeConfigRules.reorderTarget(entries.length(), index, delta) ?: return false
        val reordered = JSONArray()
        for (position in 0 until entries.length()) {
            val source = when (position) {
                index -> target
                target -> index
                else -> position
            }
            reordered.put(entries.get(source))
        }
        return prefs.edit()
            .putString("v2_home_configs", reordered.toString())
            .commit()
    }

    private fun showSavedOrderEditor() {
        val entries = savedConfigurations()
        if (entries.length() < 2) {
            toast("Cần ít nhất 2 cấu hình Home để sắp xếp")
            return
        }
        val names = Array(entries.length()) { index ->
            entries.optJSONObject(index)?.optString("name", "Home ${index + 1}")
                ?: "Home ${index + 1}"
        }
        AlertDialog.Builder(this)
            .setTitle("SẮP XẾP BỐ CỤC")
            .setMessage("Chọn cấu hình rồi dùng Lên/Xuống. Không dùng kéo thả để tránh chọn nhầm thẻ.")
            .setItems(names) { _, index ->
                val deltas = mutableListOf<Int>()
                if (index > 0) deltas += -1
                if (index < entries.length() - 1) deltas += 1
                val actions = deltas.map { delta ->
                    if (delta < 0) "↑ Đưa lên" else "↓ Đưa xuống"
                }.toTypedArray()
                AlertDialog.Builder(this)
                    .setTitle(names[index])
                    .setItems(actions) { _, choice ->
                        if (choice in deltas.indices) {
                            if (moveSavedConfiguration(index, deltas[choice])) {
                                toast("Đã cập nhật thứ tự bố cục")
                                showSavedOrderEditor()
                            } else {
                                toast("Không thể cập nhật thứ tự bố cục")
                            }
                        }
                    }
                    .setNegativeButton("Hủy", null)
                    .show()
            }
            .setNegativeButton("Đóng", null)
            .show()
    }

    private fun showSaved() {
        val entries = savedConfigurations()
        if (entries.length() == 0) {
            AlertDialog.Builder(this)
                .setTitle("Cấu hình Home")
                .setMessage("Chưa có cấu hình lưu trên thiết bị. Đây chưa phải bộ bố cục V1.")
                .setPositiveButton("Đóng", null).show()
            return
        }
        val names = Array(entries.length()) { i ->
            entries.optJSONObject(i)?.optString("name", "Home ${i + 1}") ?: "Home ${i + 1}"
        }
        AlertDialog.Builder(this)
            .setTitle("Cấu hình Home đã lưu (cục bộ)")
            .setItems(names) { _, index ->
                val item = entries.optJSONObject(index) ?: return@setItems
                AlertDialog.Builder(this)
                    .setTitle(item.optString("name", "Home"))
                    .setItems(arrayOf("Áp dụng", "Đặt làm mặc định", "Xóa cấu hình")) { _, choice ->
                        when (choice) {
                            0 -> {
                                if (applyHomeConfiguration(item, true)) {
                                    toast("Đã áp dụng cấu hình Home")
                                } else {
                                    toast("Cấu hình Home không tương thích")
                                }
                            }
                            1 -> setDefaultHomeConfiguration(item)
                            else -> {
                                val remaining = JSONArray()
                                for (i in 0 until entries.length())
                                    if (i != index) remaining.put(entries.get(i))
                                val editor = prefs.edit()
                                    .putString("v2_home_configs", remaining.toString())
                                if (prefs.getString("v2_default_home_config", null) == item.toString()) {
                                    editor.remove("v2_default_home_config")
                                }
                                if (editor.commit()) {
                                    clearSavedLayoutShortcutReferences(item.optString("configId", ""))
                                    toast("Đã xóa cấu hình khỏi thiết bị")
                                } else {
                                    toast("Không thể xóa cấu hình khỏi thiết bị")
                                }
                            }
                        }
                    }.setNegativeButton("Hủy", null).show()
            }
            .setNeutralButton("SẮP XẾP BỐ CỤC") { _, _ -> showSavedOrderEditor() }
            .setNegativeButton("Đóng", null)
            .show()
    }

    private fun exportOverlayPositions(): JSONArray {
        val overlayPrefs = getSharedPreferences("v2_camera_shortcut", Context.MODE_PRIVATE)
        val preferredDisplayId = DexUtils.resolveDisplay(this, 0)?.displayId
        val ids = overlayPrefs.all.keys
            .mapNotNull(HomeBackupRules::displayIdFromOverlayKey)
            .distinct()
            .sortedWith(
                compareBy<Int> { if (it == preferredDisplayId) 0 else 1 }
                    .thenBy { it },
            )
            .take(HomeBackupRules.MAX_OVERLAY_DISPLAYS)
        val result = JSONArray()
        for (displayId in ids) {
            val xKey = OverlayPositionRules.xKey(displayId)
            val yKey = OverlayPositionRules.yKey(displayId)
            if (!overlayPrefs.contains(xKey) || !overlayPrefs.contains(yKey)) continue
            val x = overlayPrefs.getInt(xKey, OverlayPositionRules.DEFAULT_X)
            val y = overlayPrefs.getInt(yKey, OverlayPositionRules.DEFAULT_Y)
            if (!HomeBackupRules.validOverlayCoordinate(x) ||
                !HomeBackupRules.validOverlayCoordinate(y)) continue
            result.put(
                JSONObject()
                    .put("displayId", displayId)
                    .put("x", x)
                    .put("y", y),
            )
        }
        return result
    }

    private fun validatedTaxiHistoryForBackup(source: JSONArray?): JSONArray? {
        if (source == null || source.length() > TaxiMeterRules.MAX_HISTORY) return null
        val safe = JSONArray()
        for (index in 0 until source.length()) {
            val item = source.optJSONObject(index) ?: return null
            val startedAt =
                HomeBackupRules.exactLong(item.opt("startedAt")) ?: return null
            val duration =
                HomeBackupRules.exactLong(item.opt("durationSeconds")) ?: return null
            val distance =
                HomeBackupRules.exactDouble(item.opt("distanceMeters")) ?: return null
            val rate =
                HomeBackupRules.exactDouble(item.opt("rateVndPerKm")) ?: return null
            val fare =
                HomeBackupRules.exactLong(item.opt("fareVnd")) ?: return null
            if (startedAt < 0L ||
                duration < 0L ||
                distance < 0.0 ||
                !TaxiMeterRules.validRateVndPerKm(rate) ||
                fare < 0L
            ) return null
            safe.put(
                JSONObject()
                    .put("startedAt", startedAt)
                    .put("durationSeconds", duration)
                    .put("distanceMeters", distance)
                    .put("rateVndPerKm", rate)
                    .put("fareVnd", fare),
            )
        }
        return safe
    }

    private fun exportTaxiMeterBackup(): JSONObject {
        val taxiPrefs = getSharedPreferences(TaxiMeterRules.PREFS_NAME, Context.MODE_PRIVATE)
        val configuredRate = taxiPrefs.getString(TaxiMeterRules.KEY_RATE, null)?.let { raw ->
            TaxiMeterRules.parseRateVndPerKm(raw)?.toString()
                ?: throw IllegalStateException("Taxi Meter rate không hợp lệ")
        }
        val rawHistory = try {
            JSONArray(taxiPrefs.getString(TaxiMeterRules.KEY_HISTORY, "[]") ?: "[]")
        } catch (error: Exception) {
            throw IllegalStateException("Taxi Meter history bị hỏng", error)
        }
        val safeHistory = validatedTaxiHistoryForBackup(rawHistory)
            ?: throw IllegalStateException("Taxi Meter history không hợp lệ")
        return JSONObject()
            .put("configuredRate", configuredRate ?: JSONObject.NULL)
            .put("history", safeHistory)
    }

    private fun exportSavedLayoutShortcuts(savedConfigs: JSONArray): JSONArray {
        val knownConfigIds = mutableSetOf<String>()
        for (index in 0 until savedConfigs.length()) {
            val item = savedConfigs.optJSONObject(index) ?: continue
            val configId = SavedLayoutShortcutRules.normalizeConfigId(
                item.optString("configId", ""),
            )
            if (SavedLayoutShortcutRules.validConfigId(configId)) {
                knownConfigIds.add(configId)
            }
        }

        val shortcutPrefs = savedLayoutShortcutPrefs()
        return JSONArray().also { result ->
            for (index in 0 until SavedLayoutShortcutRules.SLOT_COUNT) {
                val key = SavedLayoutShortcutRules.slotKey(index) ?: continue
                val raw = shortcutPrefs.getString(key, null)
                val configId = raw?.let(SavedLayoutShortcutRules::normalizeConfigId)
                if (configId != null &&
                    SavedLayoutShortcutRules.validConfigId(configId) &&
                    knownConfigIds.contains(configId)
                ) {
                    result.put(configId)
                } else {
                    result.put(JSONObject.NULL)
                }
            }
        }
    }

    private fun exportHomeBackupJson(): JSONObject {
        val savedConfigs = savedConfigurations()
        val defaultRaw = prefs.getString("v2_default_home_config", null)
        val defaultSafe = try {
            defaultRaw?.let { normalizeHomeConfiguration(JSONObject(it)) }
        } catch (e: Exception) {
            android.util.Log.w("UltraCarV2", "Ignoring corrupt default HOME config during backup", e)
            null
        }
        return JSONObject()
            .put("backupSchemaVersion", HomeBackupRules.CURRENT_BACKUP_SCHEMA_VERSION)
            .put("night", prefs.getBoolean("night", false))
            .put("limo", prefs.getBoolean("limo", false))
            .put(
                "vehicleModel",
                VehicleRules.currentModel(
                    prefs.getString(VehicleRules.PREF_MODEL, null),
                    prefs.getBoolean("limo", false),
                ),
            )
            .put(
                "licensePlate",
                VehicleRules.normalizeLicensePlate(
                    prefs.getString(VehicleRules.PREF_LICENSE_PLATE, "") ?: "",
                ),
            )
            .put(
                "driver",
                HomeConfigRules.normalizeName(
                    prefs.getString("driver_name", "Driver") ?: "Driver",
                ).ifEmpty { "Driver" },
            )
            .put("quickSlots", normalizedQuickSlotsForStorage(quickSlots()))
            .put("savedConfigurations", savedConfigs)
            .put("defaultHomeConfiguration", defaultSafe ?: JSONObject.NULL)
            .put("overlayPositions", exportOverlayPositions())
            .put("taxiMeter", exportTaxiMeterBackup())
            .put("savedLayoutShortcuts", exportSavedLayoutShortcuts(savedConfigs))
    }

    private fun writeHomeBackup(uri: Uri) {
        try {
            val payload = exportHomeBackupJson().toString(2)
            if (!HomeBackupRules.withinSize(payload.toByteArray(Charsets.UTF_8).size)) {
                toast("Bản sao lưu vượt giới hạn an toàn")
                return
            }
            val stream = contentResolver.openOutputStream(uri, "wt")
                ?: throw IllegalStateException("Không mở được tệp đích")
            stream.bufferedWriter(Charsets.UTF_8).use { it.write(payload) }
            toast("Đã sao lưu dữ liệu V2")
        } catch (e: Exception) {
            android.util.Log.e("UltraCarV2", "HOME backup export failed", e)
            toast("Không thể sao lưu dữ liệu V2")
        }
    }

    private fun readHomeBackup(uri: Uri) {
        try {
            val stream = contentResolver.openInputStream(uri)
                ?: throw IllegalStateException("Không mở được tệp sao lưu")
            val text = stream.bufferedReader(Charsets.UTF_8).use { reader ->
                val buffer = CharArray(8192)
                val out = StringBuilder()
                while (true) {
                    val count = reader.read(buffer)
                    if (count < 0) break
                    out.append(buffer, 0, count)
                    if (!HomeBackupRules.withinSize(out.toString().toByteArray(Charsets.UTF_8).size)) {
                        throw IllegalArgumentException("Backup vượt giới hạn")
                    }
                }
                out.toString()
            }
            if (!importHomeBackupJson(text)) {
                toast("Không thể khôi phục: tệp không hợp lệ hoặc ghi dữ liệu thất bại")
                return
            }
            render()
            refreshOverlayAfterRestore()
            toast("Đã khôi phục dữ liệu V2")
        } catch (e: Exception) {
            android.util.Log.e("UltraCarV2", "HOME backup import failed", e)
            toast("Không thể khôi phục dữ liệu V2")
        }
    }

    private fun refreshOverlayAfterRestore() {
        if (!DexUtils.isDesktop(this) || !Settings.canDrawOverlays(this)) return
        try {
            startService(
                Intent(this, OverlayService::class.java)
                    .putExtra("displayId", requestedCameraDisplayId())
                    .putExtra(OverlayService.EXTRA_FORCE_REATTACH, true),
            )
        } catch (t: Throwable) {
            android.util.Log.w("UltraCarV2", "Overlay refresh after restore failed", t)
        }
    }

    private fun preferenceSnapshot(source: SharedPreferences): Map<String, Any?> =
        source.all.mapValues { (_, value) ->
            if (value is Set<*>) value.toSet() else value
        }

    private fun restorePreferenceSnapshot(
        target: SharedPreferences,
        snapshot: Map<String, Any?>,
    ): Boolean {
        val editor = target.edit().clear()
        for ((key, value) in snapshot) {
            when (value) {
                is String -> editor.putString(key, value)
                is Boolean -> editor.putBoolean(key, value)
                is Int -> editor.putInt(key, value)
                is Long -> editor.putLong(key, value)
                is Float -> editor.putFloat(key, value)
                is Set<*> -> {
                    val strings = mutableSetOf<String>()
                    for (item in value) {
                        val text = item as? String ?: return false
                        strings.add(text)
                    }
                    editor.putStringSet(key, strings)
                }
                null -> editor.remove(key)
                else -> {
                    android.util.Log.e(
                        "UltraCarV2",
                        "Unsupported preference snapshot type for key=$key",
                    )
                    return false
                }
            }
        }
        return editor.commit()
    }

    private fun importHomeBackupJson(text: String): Boolean {
        if (!HomeBackupRules.withinSize(text.toByteArray(Charsets.UTF_8).size)) return false
        val root = try { JSONObject(text) } catch (_: Exception) { return false }
        val backupSchema =
            HomeBackupRules.exactInt(root.opt("backupSchemaVersion")) ?: return false
        if (!HomeBackupRules.canReadBackupSchema(backupSchema)) return false
        val night = HomeBackupRules.exactBoolean(root.opt("night")) ?: return false
        val legacyLimo = HomeBackupRules.exactBoolean(root.opt("limo")) ?: return false
        val rawDriver = HomeBackupRules.exactString(root.opt("driver")) ?: return false
        val driver = HomeConfigRules.normalizeName(rawDriver)
        if (driver.isEmpty()) return false

        val requiresVehicleState = HomeBackupRules.requiresVehicleState(backupSchema)
        val safeVehicleModel: String
        val safeLicensePlate: String
        if (requiresVehicleState) {
            val rawModel =
                HomeBackupRules.exactString(root.opt("vehicleModel")) ?: return false
            val rawLicensePlate =
                HomeBackupRules.exactString(root.opt("licensePlate")) ?: return false
            if (!VehicleRules.isSupportedModel(rawModel)) return false
            safeVehicleModel = rawModel
            safeLicensePlate = VehicleRules.normalizeLicensePlate(rawLicensePlate)
        } else {
            safeVehicleModel = VehicleRules.currentModel(
                null,
                legacyLimo,
            )
            safeLicensePlate = ""
        }

        val rawSlots = root.optJSONArray("quickSlots") ?: return false
        val safeSlots = validatedQuickSlotsForBackup(rawSlots) ?: return false

        val rawConfigs = root.optJSONArray("savedConfigurations") ?: return false
        if (rawConfigs.length() > HomeConfigRules.MAX_SAVED) return false
        val replaceSavedLayoutShortcuts =
            HomeBackupRules.requiresSavedLayoutShortcuts(backupSchema)
        val safeConfigIds = mutableSetOf<String>()
        val safeConfigs = JSONArray()
        for (index in 0 until rawConfigs.length()) {
            val item = rawConfigs.optJSONObject(index) ?: return false
            val safe = validatedHomeConfigurationForBackup(item) ?: return false
            if (replaceSavedLayoutShortcuts) {
                val configId = SavedLayoutShortcutRules.normalizeConfigId(
                    safe.optString("configId", ""),
                )
                if (!SavedLayoutShortcutRules.validConfigId(configId) ||
                    !safeConfigIds.add(configId)
                ) return false
            }
            safeConfigs.put(safe)
        }

        val safeSavedLayoutShortcuts =
            arrayOfNulls<String>(SavedLayoutShortcutRules.SLOT_COUNT)
        if (replaceSavedLayoutShortcuts) {
            val rawSavedLayoutShortcuts =
                root.optJSONArray("savedLayoutShortcuts") ?: return false
            if (rawSavedLayoutShortcuts.length() != SavedLayoutShortcutRules.SLOT_COUNT) {
                return false
            }
            for (index in 0 until SavedLayoutShortcutRules.SLOT_COUNT) {
                if (rawSavedLayoutShortcuts.isNull(index)) continue
                val rawConfigId =
                    HomeBackupRules.exactString(rawSavedLayoutShortcuts.opt(index))
                        ?: return false
                val configId = SavedLayoutShortcutRules.normalizeConfigId(rawConfigId)
                if (!SavedLayoutShortcutRules.validConfigId(configId) ||
                    !safeConfigIds.contains(configId)
                ) return false
                safeSavedLayoutShortcuts[index] = configId
            }
        }

        val safeDefault = if (root.isNull("defaultHomeConfiguration")) {
            null
        } else {
            val item = root.optJSONObject("defaultHomeConfiguration") ?: return false
            validatedHomeConfigurationForBackup(item) ?: return false
        }

        val replaceOverlayPositions = HomeBackupRules.requiresOverlayPositions(backupSchema)
        val safeOverlayPositions = mutableListOf<Triple<Int, Int, Int>>()
        if (replaceOverlayPositions) {
            val rawOverlayPositions = root.optJSONArray("overlayPositions") ?: return false
            if (rawOverlayPositions.length() > HomeBackupRules.MAX_OVERLAY_DISPLAYS) return false
            val seenDisplays = mutableSetOf<Int>()
            for (index in 0 until rawOverlayPositions.length()) {
                val item = rawOverlayPositions.optJSONObject(index) ?: return false
                val displayId =
                    HomeBackupRules.exactInt(item.opt("displayId")) ?: return false
                val x = HomeBackupRules.exactInt(item.opt("x")) ?: return false
                val y = HomeBackupRules.exactInt(item.opt("y")) ?: return false
                if (!HomeBackupRules.validOverlayDisplayId(displayId) ||
                    !HomeBackupRules.validOverlayCoordinate(x) ||
                    !HomeBackupRules.validOverlayCoordinate(y) ||
                    !seenDisplays.add(displayId)) return false
                safeOverlayPositions.add(Triple(displayId, x, y))
            }
        }

        val replaceTaxiMeterState = HomeBackupRules.requiresTaxiMeterState(backupSchema)
        var safeTaxiRate: String? = null
        var safeTaxiHistory = JSONArray()
        if (replaceTaxiMeterState) {
            val taxi = root.optJSONObject("taxiMeter") ?: return false
            safeTaxiRate = if (taxi.isNull("configuredRate")) {
                null
            } else {
                val rawRate =
                    HomeBackupRules.exactString(taxi.opt("configuredRate")) ?: return false
                TaxiMeterRules.parseRateVndPerKm(rawRate)?.toString() ?: return false
            }
            val rawHistory = taxi.optJSONArray("history") ?: return false
            safeTaxiHistory = validatedTaxiHistoryForBackup(rawHistory) ?: return false
        }

        val shortcutPrefsForRestore =
            if (replaceSavedLayoutShortcuts) savedLayoutShortcutPrefs() else null
        val overlayPrefsForRestore =
            if (replaceOverlayPositions) {
                getSharedPreferences("v2_camera_shortcut", Context.MODE_PRIVATE)
            } else {
                null
            }
        val taxiPrefsForRestore =
            if (replaceTaxiMeterState) {
                getSharedPreferences(TaxiMeterRules.PREFS_NAME, Context.MODE_PRIVATE)
            } else {
                null
            }

        val homeSnapshot = preferenceSnapshot(prefs)
        val shortcutSnapshot = shortcutPrefsForRestore?.let(::preferenceSnapshot)
        val overlaySnapshot = overlayPrefsForRestore?.let(::preferenceSnapshot)
        val taxiSnapshot = taxiPrefsForRestore?.let(::preferenceSnapshot)

        fun rollbackRestoreAndFail(): Boolean {
            var rollbackOk = true
            if (taxiPrefsForRestore != null && taxiSnapshot != null) {
                rollbackOk =
                    restorePreferenceSnapshot(taxiPrefsForRestore, taxiSnapshot) && rollbackOk
            }
            if (overlayPrefsForRestore != null && overlaySnapshot != null) {
                rollbackOk =
                    restorePreferenceSnapshot(overlayPrefsForRestore, overlaySnapshot) && rollbackOk
            }
            if (shortcutPrefsForRestore != null && shortcutSnapshot != null) {
                rollbackOk =
                    restorePreferenceSnapshot(shortcutPrefsForRestore, shortcutSnapshot) && rollbackOk
            }
            rollbackOk = restorePreferenceSnapshot(prefs, homeSnapshot) && rollbackOk
            if (!rollbackOk) {
                android.util.Log.e(
                    "UltraCarV2",
                    "HOME restore commit failed and preference rollback was incomplete",
                )
            }
            return false
        }

        val editor = prefs.edit()
            .putBoolean("night", night)
            .putBoolean("limo", safeVehicleModel == VehicleRules.MODEL_LIMO_RED)
            .putString(VehicleRules.PREF_MODEL, safeVehicleModel)
            .putString(VehicleRules.PREF_LICENSE_PLATE, safeLicensePlate)
            .putString("driver_name", driver)
            .putString("v2_quick_slots", safeSlots.toString())
            .putString("v2_home_configs", safeConfigs.toString())
        if (safeDefault == null) editor.remove("v2_default_home_config")
        else editor.putString("v2_default_home_config", safeDefault.toString())
        if (!editor.commit()) return rollbackRestoreAndFail()

        if (replaceSavedLayoutShortcuts) {
            val shortcutEditor = shortcutPrefsForRestore!!.edit().clear()
            for (index in 0 until SavedLayoutShortcutRules.SLOT_COUNT) {
                val configId = safeSavedLayoutShortcuts[index] ?: continue
                val key = SavedLayoutShortcutRules.slotKey(index) ?: continue
                shortcutEditor.putString(key, configId)
            }
            if (!shortcutEditor.commit()) return rollbackRestoreAndFail()
        }

        if (replaceOverlayPositions) {
            val overlayEditor = overlayPrefsForRestore!!.edit().clear()
            for ((displayId, x, y) in safeOverlayPositions) {
                overlayEditor
                    .putInt(OverlayPositionRules.xKey(displayId), x)
                    .putInt(OverlayPositionRules.yKey(displayId), y)
            }
            safeOverlayPositions.firstOrNull()?.let { (_, x, y) ->
                overlayEditor
                    .putInt(OverlayPositionRules.PORTABLE_X_KEY, x)
                    .putInt(OverlayPositionRules.PORTABLE_Y_KEY, y)
            }
            if (!overlayEditor.commit()) return rollbackRestoreAndFail()
        }

        if (replaceTaxiMeterState) {
            val taxiEditor = taxiPrefsForRestore!!.edit()
            if (safeTaxiRate == null) taxiEditor.remove(TaxiMeterRules.KEY_RATE)
            else taxiEditor.putString(TaxiMeterRules.KEY_RATE, safeTaxiRate)
            taxiEditor.putString(TaxiMeterRules.KEY_HISTORY, safeTaxiHistory.toString())
            if (!taxiEditor.commit()) return rollbackRestoreAndFail()
        }
        return true
    }

    private fun editDriverName() {
        val input = EditText(this).apply {
            setSingleLine(true)
            setText(prefs.getString("driver_name", "Driver") ?: "Driver")
            selectAll()
        }
        AlertDialog.Builder(this).setTitle("Tên tài xế hiển thị tại Home")
            .setView(input)
            .setNegativeButton("Hủy", null)
            .setPositiveButton("Lưu") { _, _ ->
                val name = HomeConfigRules.normalizeName(input.text.toString())
                if (name.isEmpty()) toast("Tên tài xế không được để trống")
                else {
                    if (prefs.edit().putString("driver_name", name).commit()) {
                        render()
                    } else {
                        toast("Không thể lưu tên tài xế V2")
                    }
                }
            }.show()
    }

    private fun showSettings() {
        val options = arrayOf(
            "Giao diện / hình nền",
            "Xe / biển số",
            "Camera USB thật (UVC Host)",
            "Cấp quyền nút Camera nổi DeX",
            "Trạng thái tương đương APP gốc",
            "GPS / Pin / Chẩn đoán",
            "Đổi tên tài xế hiển thị Home",
            "Sao lưu dữ liệu V2",
            "Khôi phục dữ liệu V2",
            "Hồ sơ người lái",
            "Quyền & riêng tư",
            "Phục hồi / định danh bản cài"
        )
        AlertDialog.Builder(this).setTitle("UltraCarHCM V2 — Bản xây dựng")
            .setItems(options) { _, which ->
                when(which) {
                    0 -> startActivity(Intent(this, AppearanceActivity::class.java))
                    1 -> startActivity(Intent(this, VehicleActivity::class.java))
                    2 -> startActivity(Intent(this, UsbCameraActivity::class.java))
                    3 -> {
                        if (!Settings.canDrawOverlays(this)) {
                            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                Uri.parse("package:$packageName")))
                        } else if (DexUtils.isDesktop(this)) {
                            startService(Intent(this, OverlayService::class.java)
                                .putExtra("displayId", requestedCameraDisplayId()))
                            toast("Đã gửi yêu cầu hiện Camera nổi trên DeX")
                        } else {
                            toast("S10 chưa kết nối màn hình DeX ngoài")
                        }
                    }
                    4 -> AlertDialog.Builder(this).setTitle("Chưa đạt V2")
                        .setMessage("Màn Home V2 vẫn đang xây dựng. Camera USB, DeX, các tab, bố cục V1 và dữ liệu gốc chưa được nghiệm thu.")
                        .setPositiveButton("Đóng", null).show()
                    5 -> startActivity(Intent(this, TelemetryActivity::class.java))
                    6 -> editDriverName()
                    7 -> exportBackupLauncher.launch(HomeBackupRules.exportFileName())
                    8 -> importBackupLauncher.launch(arrayOf("application/json", "text/plain"))
                    9 -> startActivity(Intent(this, ProfileActivity::class.java))
                    10 -> startActivity(Intent(this, PrivacyActivity::class.java))
                    11 -> startActivity(Intent(this, RecoveryActivity::class.java))
                }
            }.show()
    }

    private fun toast(message: String) =
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()
}
