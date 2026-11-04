package ai.tigeriq.camera

import android.app.job.JobParameters
import android.app.job.JobService

/** Android-managed 15-minute periodic offline-resilient telemetry/update fallback. */
class CameraOnlineJobService:JobService(){
    override fun onStartJob(params:JobParameters?):Boolean{
        if(params==null)return false
        CameraOnlineBridge.backgroundSync(applicationContext){jobFinished(params,false)}
        return true
    }
    override fun onStopJob(params:JobParameters?):Boolean=true
}
