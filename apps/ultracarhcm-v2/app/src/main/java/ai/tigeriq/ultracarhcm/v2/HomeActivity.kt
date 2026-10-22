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
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.VideoView
import android.widget.TextView
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
        root.post { render() }
        tickHandler.post(clockTick)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        root.post { render() }
    }

    override fun onDestroy() {
        tickHandler.removeCallbacks(clockTick)
        super.onDestroy()
    }

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

    private fun button(value: String, left: Float, top: Float, width: Float, height: Float,
                       outline: Boolean = true, onClick: () -> Unit) {
        val v = label(value, if (width > .30f) 18f else 13f, accent, true)
        v.background = shape(if (outline) 0x860a141a.toInt() else 0x9a132631.toInt(),
            if (outline) accent else Color.TRANSPARENT, 16f)
        v.isClickable = true
        v.contentDescription = value
        v.setOnClickListener { onClick() }
        place(v, left, top, width, height)
    }

    private fun render() {
        if (root.width == 0 || root.height == 0) return
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
            prefs.edit().putBoolean("racing", !prefs.getBoolean("racing", true)).apply()
            render()
        }
        clock = label("", 16f, Color.WHITE, true).apply {
            background = shape(0x800c1a22.toInt(), radius=8f)
        }
        place(clock!!, .026f, .334f, .22f, .074f)
        clock?.text = SimpleDateFormat("EEEE\ndd/MM\nHH:mm", Locale("vi", "VN")).format(Date())

        image(if (prefs.getBoolean("limo", false)) R.drawable.v2_car_limo_do_parked
              else R.drawable.v2_car_lambogini_trang_parked, .295f, .458f, .41f, .242f)

        button("KHỞI ĐỘNG", .028f, .78f, .79f, .063f) {
            AlertDialog.Builder(this).setTitle("Chưa nghiệm thu chức năng Khởi động")
                .setMessage("V2 đang được tái dựng từ ứng dụng chuẩn. Tính năng Khởi động và bố cục đa cửa sổ chưa tương đương. Không chuyển sang giao diện demo.")
                .setPositiveButton("Đóng", null).show()
        }
        button("⟳", .835f, .78f, .137f, .063f) { render() }
        val bottomShade = label("", 10f)
        bottomShade.background = shape(0x7d000000, radius=12f)
        place(bottomShade, .028f, .855f, .944f, .087f)
        button("▣\nBố cục đã lưu", .045f, .863f, .29f, .065f, false) { showSaved() }
        button("+\nBố cục mới", .357f, .863f, .29f, .065f, false) {
            val count = prefs.getInt("saved_count", 0) + 1
            prefs.edit().putInt("saved_count", count).apply()
            toast("Đã lưu bố cục thử nghiệm #$count (chưa tương đương bản gốc)")
        }
        val bot = VideoView(this)
        bot.setVideoURI(Uri.parse("android.resource://$packageName/${R.raw.ultrabot_glow_packed}"))
        bot.setOnPreparedListener { mp -> mp.isLooping = true; mp.setVolume(0f, 0f); bot.start() }
        bot.setOnErrorListener { _, _, _ -> true }
        place(bot, .675f, .857f, .278f, .078f)
        bot.setOnClickListener { toast("Ultrabot V2 đang được tích hợp; chưa tương đương bản gốc") }
        val footer = label("UltraCarHCM V2 • DEVELOPMENT • CHƯA NGHIỆM THU", 9f, 0xffbbbbbb.toInt())
        place(footer, .02f, .954f, .96f, .018f)
    }

    private fun showSaved() {
        AlertDialog.Builder(this)
            .setTitle("Bố cục V2")
            .setMessage("Đang có ${prefs.getInt("saved_count", 0)} bố cục thử nghiệm. Chưa nhập bố cục từ APP gốc.")
            .setPositiveButton("Đóng", null)
            .show()
    }

    private fun showSettings() {
        val options = arrayOf(
            if (prefs.getBoolean("night", false)) "Nền ban ngày" else "Nền ban đêm",
            if (prefs.getBoolean("limo", false)) "Xe Lamborghini trắng" else "Xe Limo đỏ",
            "Chẩn đoán V2 (Camera/DeX)",
            "Trạng thái tương đương APP gốc"
        )
        AlertDialog.Builder(this).setTitle("UltraCarHCM V2 — Bản xây dựng")
            .setItems(options) { _, which ->
                when(which) {
                    0 -> { prefs.edit().putBoolean("night", !prefs.getBoolean("night", false)).apply(); render() }
                    1 -> { prefs.edit().putBoolean("limo", !prefs.getBoolean("limo", false)).apply(); render() }
                    2 -> startActivity(Intent(this, MainActivity::class.java))
                    3 -> AlertDialog.Builder(this).setTitle("Chưa đạt V2")
                        .setMessage("Mới tái dựng màn Home bằng tài nguyên gốc. USB UVC, DeX, các tab, bố cục thực và dữ liệu gốc chưa tương đương.")
                        .setPositiveButton("Đóng", null).show()
                }
            }.show()
    }

    private fun toast(message: String) =
        android.widget.Toast.makeText(this, message, android.widget.Toast.LENGTH_SHORT).show()
}
