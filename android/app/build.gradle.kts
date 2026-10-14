import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/* Release signing is read from android/keystore.properties, which is generated
 * by tools/make-keystore.sh and is not committed. Without it the release build
 * produces an unsigned APK, which Android will refuse to install. */
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}

android {
    namespace = "com.smokey7428.weatherdashboard"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.smokey7428.weatherdashboard"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        if (keystorePropsFile.exists()) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("storeFile"))
                storePassword = keystoreProps.getProperty("storePassword")
                keyAlias = keystoreProps.getProperty("keyAlias")
                keyPassword = keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            /* Minification is off deliberately. The dex is a small part of this
             * APK (the bundled GeoNames list dominates it), and R8 cannot be
             * runtime-verified here, so it is not worth risking a class being
             * stripped from a build nobody can test on a device. */
            isMinifyEnabled = false
            isShrinkResources = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            if (keystorePropsFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
        debug {
            applicationIdSuffix = ".debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

/* The web app is the single source of truth. Copy it into the APK's assets on
 * every build so a shipped APK can never contain a stale copy of the UI. */
val webRoot = rootProject.projectDir.parentFile
val syncWebAssets by tasks.registering(Copy::class) {
    from(webRoot) {
        include(
            "index.html",
            "sw.js",
            "manifest.json",
            "icon-192.png",
            "icon-512.png",
            "vendor/**"
        )
    }
    into(layout.projectDirectory.dir("src/main/assets/www"))
}

tasks.named("preBuild") { dependsOn(syncWebAssets) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
