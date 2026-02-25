plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun configValue(name: String, defaultValue: String = ""): String {
    val envValue = System.getenv(name)
    if (!envValue.isNullOrBlank()) return envValue

    val propValue = project.findProperty(name) as String?
    if (!propValue.isNullOrBlank()) return propValue

    return defaultValue
}

android {
    namespace = "com.mikesibiu.ytk2kids"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.mikesibiu.ytk2kids"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        val filterApiBase = configValue("FILTER_API_BASE_URL", "https://your-koyeb-domain.koyeb.app")
        val youtubeApiKey = configValue("YOUTUBE_API_KEY", "")
        val parentPin = configValue("PARENT_PIN", "")

        buildConfigField("String", "FILTER_API_BASE_URL", "\"$filterApiBase\"")
        buildConfigField("String", "YOUTUBE_API_KEY", "\"$youtubeApiKey\"")
        buildConfigField("String", "PARENT_PIN", "\"$parentPin\"")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
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
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.12.0")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.5")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.1")
}
