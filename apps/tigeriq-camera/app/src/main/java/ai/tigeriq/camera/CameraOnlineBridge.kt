package ai.tigeriq.camera

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.app.job.JobInfo
import android.app.job.JobScheduler
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Owner-paired HTTPS diagnostic relay to PC01. No cloud data store, no raw camera frames.
 * Downloaded APK must pass hash, package name, version and signer checks.
 * Android always controls final installation consent; no hidden installer.
 */
object CameraOnlineBridge {
    const val BASE = "https://pc01.tail35d2f3.ts.net/camera-relay"
    private const val PREF = "camera_online_owner"
    private const val JOB_ID = 34081
    private val io = Executors.newSingleThreadScheduledExecutor()
    private val main = Handler(Looper.getMainLooper())
    private val queued = AtomicBoolean(false)

    private fun prefs(c: Context) = c.getSharedPreferences(PREF, Context.MODE_PRIVATE)
    fun isPaired(c: Context) = !prefs(c).getString("token", "").isNullOrEmpty()
    fun readyVersion(c: Context): Int = prefs(c).getInt("ready_code", 0)
    fun status(c: Context): String =
        if (isPaired(c)) "?? gh?p ??i PC01. Log g?i t? ??ng khi c? m?ng."
        else "Ch?a gh?p ??i PC01 (m? d?ng m?t l?n)."

    private fun request(route: String, token: String?, data: JSONObject? = null): Pair<Int, ByteArray> {
        require(route.startsWith("/v1/") && !route.contains(".."))
        val url = URL(BASE + route)
        require(url.protocol == "https" && url.host == "pc01.tail35d2f3.ts.net")
        val conn = url.openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = false
        conn.connectTimeout = 7000
        conn.readTimeout = 15000
        conn.setRequestProperty("Accept", "application/json")
        if (!token.isNullOrEmpty()) conn.setRequestProperty("Authorization", "Bearer " + token)
        if (data != null) {
            conn.requestMethod = "POST"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
        }
        try {
            if (data != null) conn.outputStream.use { it.write(data.toString().toByteArray(Charsets.UTF_8)) }
            val code = conn.responseCode
            val bytes = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.use { stream ->
                    val output = java.io.ByteArrayOutputStream()
                    val buf = ByteArray(8192)
                    while (output.size() < 65_536) {
                        val n = stream.read(buf, 0, minOf(buf.size, 65_536 - output.size()))
                        if (n < 0) break
                        output.write(buf, 0, n)
                    }
                    output.toByteArray()
                } ?: ByteArray(0)
            return code to bytes
        } finally { conn.disconnect() }
    }

    private fun json(bytes: ByteArray) = JSONObject(String(bytes, Charsets.UTF_8))

    fun pair(context: Context, code: String, done: (String) -> Unit) {
        val app = context.applicationContext
        if (!Regex("[0-9]{9}").matches(code)) { done("M? gh?p ??i c?n ??ng 9 ch? s?.");return }
        io.execute {
            val result = try {
                val (status, bytes) = request("/v1/pair", null, JSONObject().put("code", code))
                if (status != 200) "Gh?p ??i b? t? ch?i (HTTP " + status + ")."
                else {
                    val obj = json(bytes)
                    val token = obj.optString("token")
                    val id = obj.optString("id")
                    if (token.length < 35 || id.length < 10) "Ph?n h?i gh?p ??i kh?ng h?p l?."
                    else {
                        prefs(app).edit().putString("token", token).putString("device_id", id)
                            .putLong("cursor", 0L).putLong("ack", 0L).apply()
                        schedule(app)
                        "?? k?t n?i PC01. T? g?i log v? t?i c?p nh?t."
                    }
                }
            } catch (t: Throwable) { "PC01 ch?a truy c?p ???c: " + t.javaClass.simpleName }
            main.post { done(result) }
            if (isPaired(app)) onLogChanged(app)
        }
    }

    fun schedule(context: Context) {
        if (!isPaired(context)) return
        try {
            val scheduler=context.getSystemService(Context.JOB_SCHEDULER_SERVICE) as JobScheduler
            val job=JobInfo.Builder(JOB_ID,ComponentName(context,CameraOnlineJobService::class.java))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(15*60*1000L)
                .setPersisted(true)
                .build()
            scheduler.schedule(job)
        } catch(t:Throwable){Log.w("CameraOnline","Periodic scheduler unavailable",t)}
    }

    fun onLogChanged(context: Context) {
        val app=context.applicationContext
        if(!isPaired(app)||!queued.compareAndSet(false,true))return
        io.schedule({
            try { flushInternal(app) } catch (_: Throwable) {}
            finally { queued.set(false) }
        },8,TimeUnit.SECONDS)
    }

    fun syncNow(context: Context, done:(String)->Unit) {
        val app=context.applicationContext
        io.execute {
            val result=try{flushInternal(app)}catch(t:Throwable){"Kh?ng ??ng b?: "+t.javaClass.simpleName}
            main.post{done(result)}
        }
    }

    private fun flushInternal(context:Context):String {
        val token=prefs(context).getString("token","") ?: ""
        if(token.isEmpty())return "Ch?a gh?p ??i."
        val file=File(context.filesDir,"camera_events.log")
        if(!file.exists())return "Ch?a c? log."
        val raw=file.readBytes()
        var pos=prefs(context).getLong("cursor",0L).toInt()
        if(pos>raw.size||pos<0) pos=0  // bounded file rotation
        if(pos==raw.size)return "Log ?? ??ng b?."
        var end=(pos+16_384).coerceAtMost(raw.size)
        if(end<raw.size) {
            while(end>pos && raw[end-1]!='\n'.code.toByte())end--
            if(end==pos)end=(pos+16_384).coerceAtMost(raw.size)
        }
        val payload=String(raw,pos,end-pos,Charsets.UTF_8)
        val seq=prefs(context).getLong("ack",0L)+1
        val (code,bytes)=request("/v1/events",token,
            JSONObject().put("seq",seq).put("events",payload))
        if(code!=200)return "G?i log HTTP "+code
        val ack=json(bytes).optLong("ack",-1L)
        if(ack!=seq)return "ACK kh?ng kh?p."
        prefs(context).edit().putLong("cursor",end.toLong()).putLong("ack",ack).apply()
        return "?? g?i log ??n PC01, phi?n "+ack
    }

    fun backgroundSync(context:Context,done:()->Unit) {
        val app=context.applicationContext
        io.execute {
            try {
                flushInternal(app)
                val last=prefs(app).getLong("last_update_check",0L)
                if(System.currentTimeMillis()-last>15*60_000L)checkUpdateInternal(app)
            } catch(_ : Throwable){} finally {main.post{done()}}
        }
    }

    fun checkUpdate(context:Context,done:(String)->Unit) {
        val app=context.applicationContext
        io.execute{
            val result=try{checkUpdateInternal(app)}catch(t:Throwable){"C?p nh?t ch?a s?n s?ng: "+t.javaClass.simpleName}
            main.post{done(result)}
        }
    }

    private fun hexSha(input:File):String {
        val digest=MessageDigest.getInstance("SHA-256")
        input.inputStream().use{stream ->
            val b=ByteArray(32_768)
            while(true){val n=stream.read(b);if(n<0)break;digest.update(b,0,n)}
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun verifyApk(context:Context, file:File, versionCode:Int):Boolean {
        try {
            val pm=context.packageManager
            val flags=PackageManager.GET_SIGNING_CERTIFICATES
            val candidate=if(Build.VERSION.SDK_INT>=33)
                pm.getPackageArchiveInfo(file.absolutePath,PackageManager.PackageInfoFlags.of(flags.toLong()))
            else { @Suppress("DEPRECATION") pm.getPackageArchiveInfo(file.absolutePath, flags) }
            val installed=if(Build.VERSION.SDK_INT>=33)
                pm.getPackageInfo(context.packageName,PackageManager.PackageInfoFlags.of(flags.toLong()))
            else { @Suppress("DEPRECATION") pm.getPackageInfo(context.packageName,flags) }
            if(candidate==null||candidate.packageName!=context.packageName)return false
            val newCode=if(Build.VERSION.SDK_INT>=28)candidate.longVersionCode else candidate.versionCode.toLong()
            if(newCode!=versionCode.toLong()||newCode<=BuildConfig.VERSION_CODE)return false
            val sigA=candidate.signingInfo?.apkContentsSigners ?: return false
            val sigB=installed.signingInfo?.apkContentsSigners ?: return false
            return sigA.isNotEmpty()&&sigA.size==sigB.size&&sigA.map{it.toCharsString()}.toSet()==sigB.map{it.toCharsString()}.toSet()
        }catch(_ : Throwable){return false}
    }

    private fun checkUpdateInternal(context:Context):String {
        val token=prefs(context).getString("token","") ?: ""
        if(token.isEmpty())return "Ch?a gh?p ??i."
        prefs(context).edit().putLong("last_update_check",System.currentTimeMillis()).apply()
        val (code,bytes)=request("/v1/update",token)
        if(code!=200)return "Kh?ng l?y ???c b?n m?i HTTP "+code
        val latest=json(bytes).optJSONObject("latest") ?: return "Ch?a ph?t h?nh b?n m?i."
        val version=latest.optInt("versionCode")
        if(version<=BuildConfig.VERSION_CODE)return "?ang d?ng b?n m?i nh?t."
        val expected=latest.optString("sha256")
        val size=latest.optLong("bytes",-1)
        if(!Regex("[a-f0-9]{64}").matches(expected)||size !in 100_000..60_000_000L)
            return "Manifest kh?ng h?p l?."
        val target=File(context.cacheDir,"updates/TigerIQ_Camera_"+version+".apk")
        target.parentFile?.mkdirs()
        if(!target.exists()||target.length()!=size||hexSha(target)!=expected){
            val url=URL(BASE+"/v1/update/apk")
            val conn=url.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects=false;conn.connectTimeout=8000;conn.readTimeout=25_000
            conn.setRequestProperty("Authorization","Bearer "+token)
            try {
                if(conn.responseCode!=200)return "T?i APK l?i HTTP "+conn.responseCode
                val temp=File(target.absolutePath+".download.apk")
                temp.outputStream().use { output ->
                    conn.inputStream.use { input ->
                        val chunk=ByteArray(32_768);var copied=0L
                        while(true){
                            val n=input.read(chunk);if(n<0)break
                            copied+=n
                            if(copied>60_000_000L)throw IllegalStateException("OVER_SIZE")
                            output.write(chunk,0,n)
                        }
                    }
                }
                if(temp.length()!=size||hexSha(temp)!=expected){temp.delete();return "APK sai SHA-256."}
                if(!verifyApk(context,temp,version)){temp.delete();return "APK sai ch? k? ho?c package."}
                if(target.exists())target.delete()
                if(!temp.renameTo(target)){temp.delete();return "Kh?ng l?u ???c APK."}
            }finally {conn.disconnect()}
        }
        if(!verifyApk(context,target,version))return "Ki?m tra ch? k? th?t b?i."
        prefs(context).edit().putInt("ready_code",version).putString("ready_path",target.absolutePath).apply()
        notifyAvailable(context,version)
        return "?? t?i b?n "+latest.optString("versionName")+" v? x?c minh SHA/ch? k?."
    }

    private fun notifyAvailable(context:Context,version:Int){
        val nm=context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel="camera_online_update"
        if(Build.VERSION.SDK_INT>=26)nm.createNotificationChannel(
            NotificationChannel(channel,"C?p nh?t TigerIQ Camera",NotificationManager.IMPORTANCE_DEFAULT))
        val intent=Intent(context,MainActivity::class.java)
        val pending=PendingIntent.getActivity(context,343,intent,PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification=NotificationCompat.Builder(context,channel)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("TigerIQ Camera c? b?n c?p nh?t")
            .setContentText("?? t?i v? ki?m tra v"+version+". M? app ?? c?i khi xe ?ang ??.")
            .setAutoCancel(true).setContentIntent(pending).build()
        try{nm.notify(343,notification)}catch(_ : Throwable){}
    }

    fun installReady(activity:Activity):String {
        val code=readyVersion(activity)
        val file=File(prefs(activity).getString("ready_path","") ?: "")
        if(code<=BuildConfig.VERSION_CODE||!file.isFile||!verifyApk(activity,file,code))
            return "Ch?a c? APK c?p nh?t ?? x?c minh."
        if(Build.VERSION.SDK_INT>=26&&!activity.packageManager.canRequestPackageInstalls()){
            activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:"+activity.packageName)))
            return "C?p quy?n c?i ?ng d?ng r?i b?m C?I l?i."
        }
        return try{
            val uri=FileProvider.getUriForFile(activity,activity.packageName+".fileprovider",file)
            val view=Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri,"application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            activity.startActivity(view)
            "?? m? tr?nh c?i Android. Ch? x?c nh?n khi xe ?ang ??."
        }catch(t:Throwable){"Tr?nh c?i kh?ng m? ???c: "+t.javaClass.simpleName}
    }
}
