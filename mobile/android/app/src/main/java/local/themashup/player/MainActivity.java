package local.themashup.player;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Custom scoped-storage plugin (DownloadSaver) must be registered
        // before the bridge initializes so the WebView can resolve it.
        registerPlugin(DownloadSaver.class);
        super.onCreate(savedInstanceState);
    }
}
