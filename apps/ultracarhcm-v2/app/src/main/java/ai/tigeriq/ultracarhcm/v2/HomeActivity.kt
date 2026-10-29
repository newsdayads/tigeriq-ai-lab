package ai.tigeriq.ultracarhcm.v2

import android.app.Activity
import android.app.AlertDialog
import android.net.Uri
import android.content.Context
import android.content.Intent
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
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Faithful-image HOME reconstruction prototype using the actual source APK assets.
 * Original APP is the UI authority. V2 feature parity is NOT implied by this screen.
 */
class HomeActivity : Activity() {
    private lateinit var root: FrameLayout
    private val prefs by lazy { getSharedPreferences("ultracar_v2_home", Context.MODE_PRIVATE) }
    private val tickHandler = Handler(Looper.getMainLooper())
    private var clock: TextView? = null
    private var homeVideo: VideoView? = null
    private var homeVisible = false
    private val accent = Color.rgb(0, 208, 255)
    private val clockTick = object : Runnable {
        override fun run() {
            clock?.text = SimpleDateFormat("EEEE\ndd/MM\nHH:mm", Locale("vi", "VN")).format(Date())
            tickHandler.postDelayed(this, 1000L)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        @Suppress("DEPRECATION")
        window.setFlags(1024, 1024)
        root = FrameLayout(this)
        setContentView(root)
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
                .put("target", target.trim()),
        )
        prefs.edit().putString("v2_quick_slots", slots.toString()).apply()
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

    private fun quickSlotGlyph(icon: QuickSlotIcon): String = when (icon) {
        QuickSlotIcon.PLAY -> "▶"
        QuickSlotIcon.CAR -> "CAR"
        QuickSlotIcon.ROUTE -> "MAP"
        QuickSlotIcon.CAMERA -> "CAM"
        QuickSlotIcon.ADD -> "+"
        QuickSlotIcon.APPS -> "APP"
    }

    private fun renderQuickBar() {
        val slots = quickSlots()
        val slotWidth = .284f
        val slotHeight = .038f
        val leftStart = .054f
        val columnGap = .020f
        val rowGap = .006f

        // V1.0.64 lifted the three-row cluster by 50dp toward the vehicle tail.
        val baselineTopPx = root.height * .69f
        val liftedTop = ((baselineTopPx - dp(50)).coerceAtLeast(root.height * .56f)) / root.height

        for (index in 0 until QuickSlotRules.SLOT_COUNT) {
            val row = index / 3
            val column = index % 3
            val slot = slots.optJSONObject(index) ?: JSONObject()
            val label = slot.optString("label", "")
            val target = slot.optString("target", "")
            val icon = QuickSlotRules.iconFor(label, target)
            val title = if (label.isBlank()) "Ô ${index + 1}" else label
            button(
                value = "${quickSlotGlyph(icon)}  $title",
                left = leftStart + column * (slotWidth + columnGap),
                top = liftedTop + row * (slotHeight + rowGap),
                width = slotWidth,
                height = slotHeight,
                outline = false,
                onLongClick = { showQuickSlotEditor(index) },
                onClick = { launchQuickSlot(slot) },
            )
        }
    }

    private fun render() {
        if (root.width == 0 || root.height == 0) return
        releaseHomeVideo()
        root.removeAllViews()
        val night = prefs.getBoolean("night", false)
        image(if (night) R.drawable.v2_road_city_night else R.drawable.v2_road_city_day,
              0f, 0f, 1f, 1f, ImageView.ScaleType.FIT_XY)
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

        image(if (prefs.getBoolean("limo", false)) R.drawable.v2_car_limo_do_parked
              else R.drawable.v2_car_lambogini_trang_parked, .295f, .458f, .41f, .242f)

        renderQuickBar()

        button("KHỞI ĐỘNG", .028f, .78f, .79f, .063f) {
            AlertDialog.Builder(this).setTitle("Chưa nghiệm thu chức năng Khởi động")
                .setMessage("V2 đang được tái dựng từ ứng dụng chuẩn. Tính năng Khởi động và bố cục đa cửa sổ chưa tương đương. Không chuyển sang giao diện demo.")
                .setPositiveButton("Đóng", null).show()
        }
        button("⟳", .835f, .78f, .137f, .063f) { render() }
        val bottomShade = label("", 10f)
        bottomShade.background = shape(0x7d000000, radius=12f)
        place(bottomShade, .028f, .855f, .944f, .087f)
        button("▣\nCấu hình đã lưu", .045f, .863f, .29f, .065f, false) { showSaved() }
        button("+\nLưu cấu hình", .357f, .863f, .29f, .065f, false) { saveHomeConfiguration() }
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
        place(bot, .675f, .857f, .278f, .078f)
        bot.setOnClickListener { toast("Ultrabot V2 chưa tích hợp — không đổi nút này thành Camera") }
        val footer = label("UltraCarHCM V2 • DEVELOPMENT • CHƯA NGHIỆM THU", 9f, 0xffbbbbbb.toInt())
        place(footer, .02f, .954f, .96f, .018f)
    }

    // Real, device-local HOME snapshots (vehicle/theme/name only). These are not V1 layout parity.
    private fun savedConfigurations(): JSONArray = try {
        JSONArray(prefs.getString("v2_home_configs", "[]") ?: "[]")
    } catch (e: Exception) {
        android.util.Log.w("UltraCarV2", "Corrupt local HOME config", e)
        JSONArray()
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
                    current.put(JSONObject()
                        .put("name", name)
                        .put("night", prefs.getBoolean("night", false))
                        .put("limo", prefs.getBoolean("limo", false))
                        .put("driver", prefs.getString("driver_name", "Driver") ?: "Driver"))
                    prefs.edit().putString("v2_home_configs", current.toString()).apply()
                    toast("Đã lưu cấu hình Home trên thiết bị")
                }
            }.show()
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
                    .setItems(arrayOf("Áp dụng", "Xóa cấu hình")) { _, choice ->
                        if (choice == 0) {
                            prefs.edit()
                                .putBoolean("night", item.optBoolean("night", false))
                                .putBoolean("limo", item.optBoolean("limo", false))
                                .putString("driver_name", item.optString("driver", "Driver"))
                                .apply()
                            render()
                            toast("Đã áp dụng cấu hình Home")
                        } else {
                            val remaining = JSONArray()
                            for (i in 0 until entries.length())
                                if (i != index) remaining.put(entries.get(i))
                            prefs.edit().putString("v2_home_configs", remaining.toString()).apply()
                            toast("Đã xóa cấu hình khỏi thiết bị")
                        }
                    }.setNegativeButton("Hủy", null).show()
            }.setNegativeButton("Đóng", null).show()
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
                    prefs.edit().putString("driver_name", name).apply()
                    render()
                }
            }.show()
    }

    private fun showSettings() {
        val options = arrayOf(
            if (prefs.getBoolean("night", false)) "Nền ban ngày" else "Nền ban đêm",
            if (prefs.getBoolean("limo", false)) "Xe Lamborghini trắng" else "Xe Limo đỏ",
            "Camera USB thật (UVC Host)",
            "Cấp quyền nút Camera nổi DeX",
            "Trạng thái tương đương APP gốc",
            "Đổi tên tài xế hiển thị Home"
        )
        AlertDialog.Builder(this).setTitle("UltraCarHCM V2 — Bản xây dựng")
            .setItems(options) { _, which ->
                when(which) {
                    0 -> { prefs.edit().putBoolean("night", !prefs.getBoolean("night", false)).apply(); render() }
                    1 -> { prefs.edit().putBoolean("limo", !prefs.getBoolean("limo", false)).apply(); render() }
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
                    5 -> editDriverName()
                }
            }.show()
    }

    private fun toast(message: String) =
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()
}
