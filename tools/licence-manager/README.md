# Avaris2 CS Licence Manager（OSEMTEC 内部使用）

`Avaris2CS_Licence_Manager.html` 是一个独立网页文件，用 **Microsoft Edge 或 Google Chrome** 双击打开即可，不需要安装，也不联网。

## 第一次使用
1. 建一个只有 OSEMTEC 能访问的文件夹（公司文件服务器或加密 U 盘），把 `private_key.pem` 放进去。私钥另存一份备份；私钥丢了就不能再签发，也绝不能给任何人。
2. 打开 html，点 **Open Licence Folder...**，选这个文件夹，浏览器问权限时选"允许编辑"。
3. 以后打开会自动记住这个文件夹（浏览器可能再问一次权限，点 Reopen 即可）。

文件夹里会自动生成：
- `licences.json`：所有许可证台账（最重要，随文件夹一起备份）
- `backups/licences-YYYY-MM-DD.json`：每天的副本
- `keys/<序列号>.avlic`：每个发出的 key

## 签发新许可证
1. 收到客户申请邮件 → 全选复制邮件正文 → 点 **+ New Licence from Request** 粘贴（或在页面上直接 Ctrl+V）。
2. 核对 osemtec.com 账号和付款，选择版本（1D / 1D-2D）、开始日期、期限（30 天 / 1 年 / N 年 / 指定日期），可填姓名、公司、备注（订单号等）。
3. 点 **Issue Licence** → 点 **E-mail to Customer**（Gmail / Outlook.com / Microsoft 365 网页邮箱或本机邮件程序，邮件已写好，按发送即可）。

## 修改有效期 / 版本
在列表里点击任一许可证 → 改到期日（或点 +30 天、+1 年、+2 年、+3 年）、版本或客户信息 → **Save**。
系统会自动重新签发一个新 key（rev. 1、rev. 2…），历史记录全部保留，然后把新 key 发给客户，客户在 Help ▸ Register 里激活即可。

> 注意：许可证是离线验证的。**延长**没问题；**缩短或作废**只记录在台账里，客户已拿到的旧 key 在原到期日之前仍能用。要远程收回需要第二阶段的在线校验。

## 其他
- 换电脑：客户在旧电脑点 Release this Computer，把释放码发来 → 打开该许可证 ▸ Release，输入释放码核对 → 标记已释放 → 用新电脑的申请签发新许可证。
- **Export CSV** 导出全部许可证；**Import Keys...** 导入 2.2.0 软件内签发时生成的 `licence_ledger.csv`。
- 修改工具本身：编辑 `manager.src.html`，然后运行 `python3 make.py` 重新生成 html（内嵌 TweetNaCl.js，公有领域）。
