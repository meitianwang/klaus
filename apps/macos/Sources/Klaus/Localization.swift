import Foundation

/// Lightweight i18n for Klaus macOS app — Chinese/English.
enum L10n {
    static let locale: String = {
        let preferred = Locale.preferredLanguages.first ?? "en"
        return preferred.hasPrefix("zh") ? "zh" : "en"
    }()

    static var isChinese: Bool { locale == "zh" }

    // MARK: - Sidebar

    static var newChat: String { isChinese ? "新对话" : "New Chat" }
    static var noConversations: String { isChinese ? "暂无对话" : "No conversations" }
    static var startNewChat: String { isChinese ? "开始新对话" : "Start a new chat to begin" }
    static var search: String { isChinese ? "搜索..." : "Search..." }
    static var noModel: String { isChinese ? "无模型" : "No model" }
    static var delete: String { isChinese ? "删除" : "Delete" }

    // MARK: - Chat

    static var messageKlaus: String { isChinese ? "给 Klaus 发消息..." : "Message Klaus..." }
    static var you: String { isChinese ? "你" : "You" }
    static var thinking: String { isChinese ? "思考中..." : "Thinking..." }
    static var thinkingLabel: String { isChinese ? "思考" : "Thinking" }
    static var copied: String { isChinese ? "已复制" : "Copied" }
    static var copy: String { isChinese ? "复制" : "Copy" }
    static var input: String { isChinese ? "输入" : "Input" }
    static var output: String { isChinese ? "输出" : "Output" }

    // MARK: - Welcome

    static var welcomeTitle: String { "Klaus" }
    static var welcomeSubtitle: String {
        isChinese
            ? "随便问。我可以读文件、运行命令、写代码，还有更多。"
            : "Ask anything. I can read files, run commands, write code, and more."
    }

    // MARK: - Menu

    static var resume: String { isChinese ? "恢复" : "Resume" }
    static var pause: String { isChinese ? "暂停" : "Pause" }
    static var startEngine: String { isChinese ? "启动引擎" : "Start Engine" }
    static var restartEngine: String { isChinese ? "重启引擎" : "Restart Engine" }
    static var newSession: String { isChinese ? "新会话" : "New Session" }
    static var openChatPanel: String { isChinese ? "打开聊天面板" : "Open Chat Panel" }
    static var settings: String { isChinese ? "设置…" : "Settings…" }
    static var quitKlaus: String { isChinese ? "退出 Klaus" : "Quit Klaus" }
    static var voiceWake: String { isChinese ? "语音唤醒" : "Voice Wake" }
    static var canvas: String { isChinese ? "画布" : "Canvas" }
    static var talkMode: String { isChinese ? "对话模式" : "Talk Mode" }

    // MARK: - Settings

    static var engine: String { isChinese ? "引擎" : "Engine" }
    static var status: String { isChinese ? "状态" : "Status" }
    static var model: String { isChinese ? "模型" : "Model" }
    static var engineVersion: String { isChinese ? "引擎版本" : "Engine Version" }
    static var showDockIcon: String { isChinese ? "显示 Dock 图标" : "Show Dock Icon" }
    static var permissionMode: String { isChinese ? "权限模式" : "Permission Mode" }
    static var defaultMode: String { isChinese ? "默认 — 工具执行前询问" : "Default — ask before tools" }
    static var planMode: String { isChinese ? "计划 — 只读，不修改" : "Plan — read-only, no edits" }
    static var acceptEditsMode: String { isChinese ? "接受编辑 — 自动批准文件修改" : "Accept Edits — auto-approve file changes" }
    static var yoloMode: String { isChinese ? "YOLO — 自动批准所有操作" : "YOLO — auto-approve everything" }
    static var workingDirectory: String { isChinese ? "工作目录" : "Working Directory" }
    static var browse: String { isChinese ? "浏览" : "Browse" }
    static var restartWithNewSettings: String { isChinese ? "使用新设置重启引擎" : "Restart Engine with New Settings" }
    static var features: String { isChinese ? "功能" : "Features" }
    static var general: String { isChinese ? "通用" : "General" }

    // MARK: - Permissions

    static var allowOnce: String { isChinese ? "允许一次" : "Allow Once" }
    static var alwaysAllow: String { isChinese ? "始终允许" : "Always Allow" }
    static var deny: String { isChinese ? "拒绝" : "Deny" }
    static var permissionRequest: String { isChinese ? "权限请求" : "Permission" }

    // MARK: - Engine Status

    static var idle: String { isChinese ? "空闲" : "Idle" }
    static var starting: String { isChinese ? "启动中…" : "Starting…" }
    static var running: String { isChinese ? "运行中" : "Running" }
    static var stopping: String { isChinese ? "停止中…" : "Stopping…" }
    static func failed(_ reason: String) -> String {
        isChinese ? "失败: \(reason)" : "Failed: \(reason)"
    }
}
