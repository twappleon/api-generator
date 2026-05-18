# DataSource Callback Test Suite

## 概述 / Overview

这是一个用于测试余额查询API的完整测试套件，提供了两种实现方式：
- **OkHttpClientTest**: 使用OkHttp库的完整功能测试
- **SimpleHttpClientTest**: 使用项目现有HttpUtil的简化测试

This is a comprehensive test suite for testing the Balance Query API, providing two implementation approaches:
- **OkHttpClientTest**: Full-featured testing using OkHttp library
- **SimpleHttpClientTest**: Simplified testing using the project's existing HttpUtil

## 项目结构 / Project Structure

```
datasource/callback/
├── README.md                          # 本文档
├── client/
│   ├── OkHttpClientTest.java        # OkHttp客户端测试实现
│   └── SimpleHttpClientTest.java    # 简单HTTP客户端测试实现
├── config/
│   └── ApiConfig.java               # API配置常量
├── model/
│   ├── BalanceRequest.java         # 余额查询请求模型
│   └── BalanceResponse.java        # 余额查询响应模型
└── DataSourceCallbackTestRunner.java # 主测试运行器
```

## 快速开始 / Quick Start

### 方式1: 使用SimpleHttpClientTest（无需额外依赖）

```java
// 直接运行主方法
SimpleHttpClientTest.main(new String[]{});

// 或在代码中使用
SimpleHttpClientTest test = new SimpleHttpClientTest();
BalanceResponse response = test.testBalanceApiDefault();
System.out.println("Result: " + response.isSuccess());
```

### 方式2: 使用OkHttpClientTest（需要OkHttp依赖）

首先添加OkHttp依赖到项目中：

```xml
<!-- Maven -->
<dependency>
    <groupId>com.squareup.okhttp3</groupId>
    <artifactId>okhttp</artifactId>
    <version>4.11.0</version>
</dependency>
```

```gradle
// Gradle
implementation 'com.squareup.okhttp3:okhttp:4.11.0'
```

然后使用测试类：

```java
OkHttpClientTest test = new OkHttpClientTest();
BalanceResponse response = test.testBalanceApiDefault();
```

### 方式3: 使用完整测试运行器

```java
// 运行交互式测试菜单
DataSourceCallbackTestRunner.main(new String[]{});
```

## API配置 / API Configuration

在 `ApiConfig.java` 中配置API端点和默认参数：

```java
// API基础URL
public static final String BASE_URL = "http://facai.hkpccfnewozt.xyz";

// 余额查询端点
public static final String BALANCE_ENDPOINT = "/tfghb/v1/api/balance";

// 测试账号
public static final String TEST_MEMBER_ACCOUNT = "fcstwleon2025082727939968";

// 货币类型
public static final String TEST_CURRENCY = "VND";

// 游戏ID
public static final int TEST_GAME_ID = 22020;
```

## 测试用例 / Test Cases

### 1. 默认参数测试
使用配置文件中的默认参数进行测试

### 2. 自定义参数测试
允许输入自定义的会员账号、货币类型和游戏ID

### 3. 原始格式测试
使用需求中提供的原始JSON格式进行测试

### 4. 异步请求测试
测试异步API调用（仅OkHttpClient支持）

### 5. 重试机制测试
测试带有重试逻辑的API调用

### 6. 批量请求测试
同时发送多个请求测试并发性能

### 7. 性能测试
执行多次请求并统计平均响应时间

### 8. 错误处理测试
测试各种错误场景的处理

## 请求示例 / Request Example

```json
{
  "MemberAccount": "fcstwleon2025082727939968",
  "Currency": "VND",
  "GameID": 22020,
  "Ts": 1659405665545
}
```

## 响应示例 / Response Example

```json
{
  "code": 200,
  "message": "Success",
  "data": {
    "balance": 1000.00,
    "currency": "VND",
    "memberAccount": "fcstwleon2025082727939968",
    "updateTime": 1659405665545
  },
  "timestamp": 1659405665545
}
```

## 运行测试 / Running Tests

### 命令行运行
```bash
# 编译项目
javac -cp . site/forgus/plugins/apigenerator/datasource/callback/**/*.java

# 运行简单测试
java site.forgus.plugins.apigenerator.datasource.callback.client.SimpleHttpClientTest

# 运行完整测试套件
java site.forgus.plugins.apigenerator.datasource.callback.DataSourceCallbackTestRunner
```

### IDE运行
1. 在IDE中打开项目
2. 导航到对应的测试类
3. 右键点击并选择"Run"

## 注意事项 / Notes

1. **网络连接**: 确保能够访问测试API端点
2. **超时设置**: 默认超时时间为10秒，可在ApiConfig中调整
3. **错误处理**: 所有测试都包含了适当的错误处理
4. **日志输出**: 测试会输出详细的请求和响应日志用于调试

## 扩展 / Extension

可以通过以下方式扩展测试套件：

1. **添加新的API端点**: 在ApiConfig中添加新的端点常量
2. **创建新的模型类**: 在model包中添加新的请求/响应模型
3. **实现新的测试场景**: 在测试类中添加新的测试方法
4. **自定义HTTP客户端**: 实现自己的HTTP客户端封装

## 故障排查 / Troubleshooting

### 连接超时
- 检查网络连接
- 增加超时时间设置
- 验证API端点是否可访问

### JSON解析错误
- 检查响应格式是否匹配模型类
- 验证JSON字段名称是否正确
- 查看详细的错误日志

### 依赖问题
- 如果使用OkHttpClient，确保已添加依赖
- 使用SimpleHttpClientTest作为替代方案

## 联系方式 / Contact

如有问题或建议，请联系开发团队。