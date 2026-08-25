package com.lagrange.agent

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val webView = WebView(this)
        setContentView(webView)

        val w = webView.settings
        w.javaScriptEnabled = true
        w.domStorageEnabled = true
        w.databaseEnabled = true
        w.allowFileAccess = true
        w.allowContentAccess = true
        w.allowFileAccessFromFileURLs = true
        w.allowUniversalAccessFromFileURLs = true
        w.mediaPlaybackRequiresUserGesture = false
        w.cacheMode = WebSettings.LOAD_DEFAULT

        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = WebViewClient()

        // 打包进的静态前端（含知识库，离线可检索）；LLM 默认走后端代理 URL（可在应用内设置）
        try {
            webView.loadUrl("file:///android_asset/www/index.html")
        } catch (e: Exception) {
            // ignore
        }
    }

    override fun onBackPressed() { /* 交给 WebView 内历史 */ }
}
