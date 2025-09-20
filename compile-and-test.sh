#!/bin/bash

# 编译和测试脚本
# 用于编译项目并运行余额API测试

echo "=== 余额API测试编译和运行脚本 ==="
echo

# 设置变量
PROJECT_ROOT="/workspace"
SRC_DIR="$PROJECT_ROOT/src"
TEST_DIR="$PROJECT_ROOT/test"
BUILD_DIR="$PROJECT_ROOT/build"
LIB_DIR="$PROJECT_ROOT/lib"

# 创建构建目录
echo "创建构建目录..."
mkdir -p "$BUILD_DIR/classes"
mkdir -p "$BUILD_DIR/test-classes"
mkdir -p "$LIB_DIR"

# 下载必要的依赖 (如果不存在)
echo "检查依赖库..."

# OkHttp 依赖
OKHTTP_JAR="$LIB_DIR/okhttp-4.12.0.jar"
OKIO_JAR="$LIB_DIR/okio-3.6.0.jar"
GSON_JAR="$LIB_DIR/gson-2.10.1.jar"
JUNIT_JAR="$LIB_DIR/junit-4.13.2.jar"
HAMCREST_JAR="$LIB_DIR/hamcrest-core-1.3.jar"

if [ ! -f "$OKHTTP_JAR" ]; then
    echo "下载 OkHttp..."
    wget -O "$OKHTTP_JAR" "https://repo1.maven.org/maven2/com/squareup/okhttp3/okhttp/4.12.0/okhttp-4.12.0.jar"
fi

if [ ! -f "$OKIO_JAR" ]; then
    echo "下载 Okio..."
    wget -O "$OKIO_JAR" "https://repo1.maven.org/maven2/com/squareup/okio/okio/3.6.0/okio-3.6.0.jar"
fi

if [ ! -f "$GSON_JAR" ]; then
    echo "下载 Gson..."
    wget -O "$GSON_JAR" "https://repo1.maven.org/maven2/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar"
fi

if [ ! -f "$JUNIT_JAR" ]; then
    echo "下载 JUnit..."
    wget -O "$JUNIT_JAR" "https://repo1.maven.org/maven2/junit/junit/4.13.2/junit-4.13.2.jar"
fi

if [ ! -f "$HAMCREST_JAR" ]; then
    echo "下载 Hamcrest..."
    wget -O "$HAMCREST_JAR" "https://repo1.maven.org/maven2/org/hamcrest/hamcrest-core/1.3/hamcrest-core-1.3.jar"
fi

# 构建classpath
CLASSPATH="$BUILD_DIR/classes:$BUILD_DIR/test-classes:$OKHTTP_JAR:$OKIO_JAR:$GSON_JAR:$JUNIT_JAR:$HAMCREST_JAR"

echo "编译源代码..."
# 编译主要源代码
find "$SRC_DIR" -name "*.java" -print0 | xargs -0 javac -cp "$CLASSPATH" -d "$BUILD_DIR/classes"

if [ $? -ne 0 ]; then
    echo "源代码编译失败！"
    exit 1
fi

echo "编译测试代码..."
# 编译测试代码
find "$TEST_DIR" -name "*.java" -print0 | xargs -0 javac -cp "$CLASSPATH" -d "$BUILD_DIR/test-classes"

if [ $? -ne 0 ]; then
    echo "测试代码编译失败！"
    exit 1
fi

echo "编译完成！"
echo

# 运行简单测试器
echo "=== 运行测试 ==="
echo "运行 TestRunner (不依赖JUnit)..."
java -cp "$CLASSPATH" site.forgus.plugins.apigenerator.datasource.TestRunner

echo
echo "=== 测试完成 ==="

# 可选：运行JUnit测试（如果需要）
echo
echo "如果要运行JUnit测试，请执行："
echo "java -cp \"$CLASSPATH\" org.junit.runner.JUnitCore site.forgus.plugins.apigenerator.datasource.BalanceApiCallbackTest"