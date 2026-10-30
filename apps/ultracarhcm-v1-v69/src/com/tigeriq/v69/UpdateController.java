package com.tigeriq.v69;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.*;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

public final class UpdateController {
    private static final String TAG = "TigerIQ-V69-Updater";
    private static final String FEED = "https://raw.githubusercontent.com/newsdayads/tigeriq-ai-lab/main/version.json";
    private static final String CERT = "71617043EACE89E5F220EA9168B0A9592808111B0F17EAA219F5E6ECEB569558";
    private static volatile boolean busy;
    private UpdateController() {}

    public static void start(Activity activity) {
        if (activity == null || activity.isFinishing()) return;
        if (busy) { note(activity, "Đang kiểm tra hoặc tải bản cập nhật"); return; }
        busy = true;
        note(activity, "Đang kiểm tra bản cập nhật...");
        new Thread(() -> runUpdate(activity), "TigerIQ-DirectUpdater").start();
    }

    private static void runUpdate(Activity a) {
        File temp = null;
        ProgressDialog progress = null;
        try {
            JSONObject meta = new JSONObject(readFeed(FEED));
            int latest = meta.getInt("latestVersionCode");
            String label = meta.optString("latestVersionName", "v" + latest);
            PackageManager pm = a.getPackageManager();
            PackageInfo installed = pm.getPackageInfo(a.getPackageName(), 0);
            if (latest <= installed.versionCode) {
                note(a, "Đã là phiên bản mới nhất (" + installed.versionName + ")");
                return;
            }
            String hash = meta.optString("sha256", "").toUpperCase(Locale.US);
            String url = meta.optString("apkUrl", "");
            if (!hash.matches("[0-9A-F]{64}")) throw new IOException("Thiếu SHA-256 hợp lệ trên máy chủ");
            checkUrl(url);
            if (url.contains("/folders/")) throw new IOException("Nguồn phát hành chỉ trỏ thư mục, không phải APK");
            File directory = a.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (directory == null) directory = new File(a.getCacheDir(), "updates");
            if (!directory.exists() && !directory.mkdirs()) throw new IOException("Không tạo được thư mục tải");
            temp = new File(directory, "TigerIQ_Update_" + latest + ".apk");
            if (temp.exists() && !temp.delete()) throw new IOException("Không xóa được file tải cũ");
            final ProgressDialog dialog = new ProgressDialog(a);
            dialog.setTitle("Cập nhật UltraCar");
            dialog.setMessage("Đang tải " + label);
            dialog.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
            dialog.setMax(100);
            dialog.setCancelable(false);
            a.runOnUiThread(() -> { if (!a.isFinishing()) dialog.show(); });
            progress = dialog;
            HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
            con.setConnectTimeout(18000); con.setReadTimeout(30000);
            con.setRequestProperty("User-Agent", "TigerIQ-UltraCar/1.0");
            con.setInstanceFollowRedirects(true);
            int code = con.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code);
            checkUrl(con.getURL().toString());
            int size = con.getContentLength();
            long total=0;
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            try (InputStream in = con.getInputStream(); FileOutputStream out = new FileOutputStream(temp)) {
                byte[] buf = new byte[65536]; int n; long last=0;
                while ((n=in.read(buf))!=-1) {
                    if (n==0) continue;
                    out.write(buf,0,n); sha.update(buf,0,n); total+=n;
                    if (size>0 && System.currentTimeMillis()-last>350) {
                        int percent=(int)Math.min(99,(100*total)/size);
                        a.runOnUiThread(()->dialog.setProgress(percent)); last=System.currentTimeMillis();
                    }
                    if (total > 250L*1024*1024) throw new IOException("APK vượt giới hạn kích thước");
                }
            } finally { con.disconnect(); }
            String actual=hex(sha.digest());
            if (!hash.equals(actual)) throw new SecurityException("SHA-256 APK không khớp máy chủ");
            if (temp.length() < 1024*1024) throw new SecurityException("APK không hợp lệ: dung lượng quá nhỏ");
            try (FileInputStream f = new FileInputStream(temp)) {
                if (f.read()!=0x50 || f.read()!=0x4b) throw new SecurityException("Tệp tải không phải APK ZIP");
            }
            int flags = Build.VERSION.SDK_INT>=28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
            PackageInfo candidate=pm.getPackageArchiveInfo(temp.getAbsolutePath(),flags);
            if (candidate==null || !a.getPackageName().equals(candidate.packageName) ||
                    candidate.versionCode != latest || candidate.versionCode<=installed.versionCode) {
                throw new SecurityException("APK sai package hoặc versionCode");
            }
            if (!CERT.equals(certFingerprint(candidate)) || !CERT.equals(certFingerprint(pm.getPackageInfo(a.getPackageName(),flags))))
                throw new SecurityException("Chữ ký APK không đúng khóa UltraCar đã dùng");
            File ready=temp;
            a.runOnUiThread(()-> {
                dialog.dismiss();
                try { launchInstaller(a, ready); }
                catch (Exception error) { failure(a,error); }
            });
            temp=null;
        } catch (Exception e) {
            if (progress != null) { ProgressDialog p=progress; a.runOnUiThread(p::dismiss); }
            failure(a,e);
        } finally {
            if (temp != null && temp.exists()) temp.delete();
            busy=false;
        }
    }

    private static String readFeed(String uri) throws Exception {
        checkUrl(uri);
        HttpURLConnection c=(HttpURLConnection)new URL(uri).openConnection();
        c.setConnectTimeout(12000); c.setReadTimeout(12000);
        try {
            if(c.getResponseCode()!=200) throw new IOException("Không đọc được cấu hình cập nhật");
            checkUrl(c.getURL().toString());
            try(InputStream in=c.getInputStream(); ByteArrayOutputStream out=new ByteArrayOutputStream()) {
                byte[] b=new byte[2048]; int n;
                while((n=in.read(b))!=-1) {
                    out.write(b,0,n);
                    if(out.size()>16384) throw new IOException("Feed quá lớn");
                }
                return out.toString("UTF-8");
            }
        } finally { c.disconnect(); }
    }

    private static void checkUrl(String value) throws Exception {
        URL u=new URL(value);
        String host=u.getHost().toLowerCase(Locale.US);
        if (!"https".equals(u.getProtocol()) ||
            !(host.equals("raw.githubusercontent.com") ||
              host.equals("github.com") ||
              host.equals("objects.githubusercontent.com") ||
              host.equals("release-assets.githubusercontent.com") ||
              host.equals("drive.google.com") ||
              host.equals("drive.usercontent.google.com")))
            throw new SecurityException("Nguồn tải APK chưa được phê duyệt");
    }

    private static String certFingerprint(PackageInfo info) throws Exception {
        Signature[] signatures;
        if(Build.VERSION.SDK_INT>=28) {
            if(info.signingInfo==null) throw new SecurityException("Không tìm thấy chữ ký APK");
            signatures=info.signingInfo.getApkContentsSigners();
        } else signatures=info.signatures;
        if(signatures==null || signatures.length!=1) throw new SecurityException("APK signer không hợp lệ");
        return hex(MessageDigest.getInstance("SHA-256").digest(signatures[0].toByteArray()));
    }

    private static String hex(byte[] raw) {
        StringBuilder s=new StringBuilder();
        for(byte b:raw) s.append(String.format(Locale.US,"%02X",b & 255));
        return s.toString();
    }

    private static void launchInstaller(Activity a, File f) throws Exception {
        if(Build.VERSION.SDK_INT>=26 && !a.getPackageManager().canRequestPackageInstalls()) {
            Intent settings=new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:"+a.getPackageName()));
            a.startActivity(settings);
            note(a,"Cho phép cài ứng dụng từ nguồn này, sau đó bấm Cập nhật lại");
            return;
        }
        Class<?> fp=Class.forName("androidx.core.content.FileProvider");
        Method method=fp.getMethod("getUriForFile",android.content.Context.class,String.class,File.class);
        Uri uri=(Uri)method.invoke(null,a,a.getPackageName()+".fileprovider",f);
        Intent install=new Intent(Intent.ACTION_VIEW);
        install.setDataAndType(uri,"application/vnd.android.package-archive");
        install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_ACTIVITY_NEW_TASK);
        a.startActivity(install); // Android system confirmation is mandatory.
    }
    private static void note(Activity a,String message) {
        a.runOnUiThread(()-> {
            if(!a.isFinishing()) Toast.makeText(a,message,Toast.LENGTH_LONG).show();
        });
    }
    private static void failure(Activity a,Exception e) {
        Log.e(TAG,"Update rejected",e);
        a.runOnUiThread(()-> {
            if(!a.isFinishing()) new AlertDialog.Builder(a).setTitle("Không thể cập nhật")
              .setMessage(e.getMessage()==null?"Lỗi tải hoặc xác minh APK":e.getMessage())
              .setPositiveButton("Đóng",null).show();
        });
    }
}
