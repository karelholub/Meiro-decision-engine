plugins {
    kotlin("jvm") version "2.0.21"
    kotlin("plugin.serialization") version "2.0.21"
    `maven-publish`
}

group = providers.gradleProperty("GROUP").getOrElse("com.decisioning")
version = providers.gradleProperty("VERSION_NAME").getOrElse("0.1.0")

repositories {
    mavenCentral()
}

kotlin {
    jvmToolchain(17)
}

java {
    withSourcesJar()
    withJavadocJar()
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}

tasks.test {
    useJUnitPlatform()
}

publishing {
    publications {
        create<MavenPublication>("mavenJava") {
            from(components["java"])
            groupId = providers.gradleProperty("GROUP").getOrElse("com.decisioning")
            artifactId = providers.gradleProperty("POM_ARTIFACT_ID").getOrElse("sdk-android")
            version = providers.gradleProperty("VERSION_NAME").getOrElse("0.1.0")

            pom {
                name.set(providers.gradleProperty("POM_NAME").getOrElse("Decisioning Android SDK"))
                description.set(
                    providers.gradleProperty("POM_DESCRIPTION").getOrElse(
                        "Lightweight Android/Kotlin SDK for Decisioning in-app decide and event tracking."
                    )
                )
                licenses {
                    license {
                        name.set(providers.gradleProperty("POM_LICENSE_NAME").getOrElse("UNLICENSED"))
                    }
                }
                developers {
                    developer {
                        id.set(providers.gradleProperty("POM_DEVELOPER_ID").getOrElse("decisioning"))
                        name.set(providers.gradleProperty("POM_DEVELOPER_NAME").getOrElse("Decisioning Team"))
                    }
                }
            }
        }
    }
}
