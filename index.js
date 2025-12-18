const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();
const db = require('./database');
const stats = require('./statistics');

const token = process.env.TELEGRAM_BOT_TOKEN;
const requiredChannelId = process.env.REQUIRED_CHANNEL_ID;
const channelInviteLink = process.env.CHANNEL_INVITE_LINK;
const adminIds = (process.env.ADMIN_ID || '').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

// --- RENDER.COM KEEPALIVE ---
const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('CPA Bot is Running!');
});

app.listen(port, () => {
    console.log(`Web server running on port ${port}`);
});
// ----------------------------

if (!token) {
    console.error('Error: TELEGRAM_BOT_TOKEN is not defined in .env');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// State management for Admin inputs
const userStates = {};

// Helper: Check if user joined the channel
// Helper: Check if user joined the channel
async function checkSubscription(userId) {
    // 0. Admin Bypass (Always allow admins)
    if (adminIds.includes(userId)) return true;

    if (!requiredChannelId) return true; // No channel set, skip check
    try {
        const chatMember = await bot.getChatMember(requiredChannelId, userId);
        console.log(`Subscription Check: User ${userId} status is '${chatMember.status}'`);

        // Accepted statuses (added 'restricted' just in case)
        return ['creator', 'administrator', 'member', 'restricted'].includes(chatMember.status);
    } catch (error) {
        console.error(`Error checking subscription for User ${userId}:`, error.message);
        // If error occurs (e.g., bot not admin), we default to false (locked) 
        // but log it clearly so it can be fixed.
        return false;
    }
}

// Helper: Get Main Menu Keyboard
function getMainMenu() {
    const sections = db.getSections();
    const buttons = sections.map(s => [{ text: s.title, callback_data: `view_${s.id}` }]);
    // Proxy button is now a regular section, so no need to push explicitly
    return {
        inline_keyboard: buttons
    };
}

// Command: /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    // Stats Tracking
    stats.registerUser(msg.from);
    stats.logInteraction(userId);

    const isJoined = await checkSubscription(userId);

    if (!isJoined) {
        await bot.sendMessage(chatId, `👋 مرحباً بك!\n\nيجب عليك الانضمام إلى القناة لاستخدام البوت:\n${channelInviteLink || ''}`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'تحقق من الانضمام ✅', callback_data: 'check_join' }]
                ]
            }
        });
        return;
    }

    let text = '👋 مرحباً بك في البوت التعليمي لمجال CPA!\n\nاختر القسم الذي تريد تعلمه:';
    const opts = { reply_markup: getMainMenu() };

    // Add Admin Button if user is admin
    if (adminIds.includes(userId)) {
        text += '\n\n🔧 *لوحة التحكم للمسؤول* 👇';
        opts.reply_markup.inline_keyboard.push([{ text: '⚙️ لوحة التحكم', callback_data: 'admin_panel' }]);
    }

    await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...opts });
});

// Command: /admin (Shortcut)
bot.onText(/\/admin/, async (msg) => {
    if (!adminIds.includes(msg.from.id)) return;
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, '⚙️ *لوحة التحكم*', {
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '➕ إضافة قسم', callback_data: 'admin_add' }],
                [{ text: '❌ حذف قسم', callback_data: 'admin_delete_list' }],
                [{ text: '🔃 ترتيب الأقسام', callback_data: 'admin_reorder' }],
                [{ text: '📝 تعديل نص البروكسي', callback_data: 'admin_edit_proxy' }]
            ]
        }
    });
});

// Handle Callback Queries
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    // 1. Global Subscription Check for all actions except 'check_join'
    if (data !== 'check_join') {
        const isJoined = await checkSubscription(userId);
        if (!isJoined) {
            await bot.answerCallbackQuery(query.id, { text: '⚠️ يجب الانضمام للقناة أولاً!', show_alert: true });
            await bot.sendMessage(chatId, `⚠️ عذراً، يجب عليك الانضمام إلى القناة لاستخدام البوت:\n${channelInviteLink || ''}`, {
                reply_markup: {
                    inline_keyboard: [[{ text: 'تحقق من الانضمام ✅', callback_data: 'check_join' }]]
                }
            });
            return;
        }
    }

    // 2. Check Join (Explicit button click)
    if (data === 'check_join') {
        const isJoined = await checkSubscription(userId);
        if (isJoined) {
            await bot.sendMessage(chatId, '✅ تم التحقق! يمكنك الآن استخدام البوت.', {
                reply_markup: getMainMenu()
            });
        } else {
            await bot.answerCallbackQuery(query.id, { text: '❌ لم تنضم للقناة بعد!', show_alert: true });
        }
        return;
    }

    // 2. View Section
    if (data.startsWith('view_')) {
        const sectionId = data.split('view_')[1];
        const section = db.getSection(sectionId);
        if (section) {
            await bot.sendMessage(chatId, `📚 *${section.title}*\n\n${section.content}`, { parse_mode: 'Markdown' });
        } else {
            // Fallback for legacy proxy requests if they somehow come here or if ID changed
            await bot.answerCallbackQuery(query.id, { text: 'عذراً، هذا القسم لم يعد موجوداً.', show_alert: true });
        }
        return;
    }

    // 3. Admin: Panel
    if (data === 'admin_panel') {
        if (!adminIds.includes(userId)) return;
        await bot.editMessageText('⚙️ *لوحة التحكم*', {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➕ إضافة قسم', callback_data: 'admin_add' }],
                    [{ text: '❌ حذف قسم', callback_data: 'admin_delete_list' }],
                    [{ text: '🔃 ترتيب الأقسام', callback_data: 'admin_reorder' }],
                    [{ text: '📝 تعديل محتوى قسم', callback_data: 'admin_edit_list' }],
                    [{ text: '📊 الإحصائيات (Stats)', callback_data: 'admin_stats' }],
                    [{ text: '🔙 رجوع', callback_data: 'back_home' }]
                ]
            }
        });
        return;
    }

    // 4. Admin: Add Section
    if (data === 'admin_add') {
        if (!adminIds.includes(userId)) return;
        userStates[userId] = { action: 'awaiting_title' };
        await bot.sendMessage(chatId, '📝 أرسل عنوان القسم الجديد:');
        return;
    }

    // 5. Admin: List for Delete
    if (data === 'admin_delete_list') {
        if (!adminIds.includes(userId)) return;
        const sections = db.getSections();
        const buttons = sections.map(s => [{ text: `🗑 ${s.title}`, callback_data: `delete_${s.id}` }]);
        buttons.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);

        await bot.editMessageText('اختر القسم المراد حذفه:', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: buttons }
        });
        return;
    }

    // 6. Admin: Perform Delete
    if (data.startsWith('delete_')) {
        if (!adminIds.includes(userId)) return;
        const sectionId = data.split('delete_')[1];
        db.deleteSection(sectionId);
        await bot.answerCallbackQuery(query.id, { text: '✅ تم الحذف بنجاح' });
        // Refresh list
        const sections = db.getSections();
        const buttons = sections.map(s => [{ text: `🗑 ${s.title}`, callback_data: `delete_${s.id}` }]);
        buttons.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);

        await bot.editMessageText('اختر القسم المراد حذفه:', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: buttons }
        });
        return;
    }

    // 7. Request Proxy (Legacy Handler)
    if (data === 'request_proxy') {
        // Just show the section content if it exists, otherwise legacy text
        const sections = db.getSections();
        const proxySec = sections.find(s => s.title.includes('بروكسي') || s.id.includes('proxy'));
        const text = proxySec ? proxySec.content : "⚠️ لم يتم العثور على معلومات البروكسي.";
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        return;
    }

    // 8. Admin: List for Edit
    if (data === 'admin_edit_list') {
        if (!adminIds.includes(userId)) return;
        const sections = db.getSections();
        const buttons = sections.map(s => [{ text: `✏️ ${s.title}`, callback_data: `edit_sec_${s.id}` }]);
        buttons.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);

        await bot.editMessageText('اختر القسم المراد تعديل محتواه:', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: buttons }
        });
        return;
    }

    // 9. Admin: Select Section to Edit
    if (data.startsWith('edit_sec_')) {
        if (!adminIds.includes(userId)) return;
        const sectionId = data.split('edit_sec_')[1];
        const section = db.getSection(sectionId);

        if (!section) {
            await bot.answerCallbackQuery(query.id, { text: 'القسم غير موجود!', show_alert: true });
            return;
        }

        userStates[userId] = { action: 'awaiting_edit_content', sectionId: sectionId };

        await bot.sendMessage(chatId, `📝 المحتوى الحالي للقسم (${section.title}):\n\n"${section.content}"\n\n👇 أرسل المحتوى الجديد الآن:`);
        return;
    }

    // 10. Admin: Reorder Menu
    if (data === 'admin_reorder') {
        if (!adminIds.includes(userId)) return;
        const sections = db.getSections();
        const buttons = sections.map(s => [
            { text: s.title, callback_data: 'noop' },
            { text: '⬆️', callback_data: `move_up_${s.id}` },
            { text: '⬇️', callback_data: `move_down_${s.id}` }
        ]);
        buttons.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);

        await bot.editMessageText('🔃 استخدم الأسهم لترتيب الأقسام:', {
            chat_id: chatId,
            message_id: query.message.message_id,
            reply_markup: { inline_keyboard: buttons }
        });
        return;
    }

    // 11. Admin: Move Up/Down
    if (data.startsWith('move_')) {
        if (!adminIds.includes(userId)) return;
        const parts = data.split('_');
        const direction = parts[1];
        const sectionId = parts.slice(2).join('_');

        db.moveSection(sectionId, direction);

        // Refresh list
        const sections = db.getSections();
        const buttons = sections.map(s => [
            { text: s.title, callback_data: 'noop' },
            { text: '⬆️', callback_data: `move_up_${s.id}` },
            { text: '⬇️', callback_data: `move_down_${s.id}` }
        ]);
        buttons.push([{ text: '🔙 رجوع', callback_data: 'admin_panel' }]);

        try {
            await bot.editMessageText('🔃 استخدم الأسهم لترتيب الأقسام:', {
                chat_id: chatId,
                message_id: query.message.message_id,
                reply_markup: { inline_keyboard: buttons }
            });
        } catch (err) { }
        return;
    }

    // 12. Start Quiz (Legacy)
    if (data === 'start_quiz') {
        await bot.answerCallbackQuery(query.id, { text: 'عذراً، لا توجد اختبارات حالياً.', show_alert: true });
        return;
    }

    // 13. Back Home
    if (data === 'back_home') {
        const text = '👋 مرحباً بك في البوت التعليمي لمجال CPA!\n\nاختر القسم الذي تريد تعلمه:';
        let opts = { reply_markup: getMainMenu() };
        if (adminIds.includes(userId)) {
            opts.reply_markup.inline_keyboard.push([{ text: '⚙️ لوحة التحكم', callback_data: 'admin_panel' }]);
        }

        await bot.editMessageText(text, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            ...opts
        });
        return;
    }

    // 14. Admin: View Stats
    if (data === 'admin_stats') {
        if (!adminIds.includes(userId)) return;
        const report = stats.getStats();
        const recent = stats.getRecentUsers(5);

        let msgText = `📊 *إحصائيات البوت*\n\n`;
        msgText += `👥 عدد المستخدمين الكلي: ${report.totalUsers}\n`;
        msgText += `🔄 عدد التفاعلات (Start): ${report.totalInteractions}\n`;
        msgText += `📅 المستخدمين النشطين اليوم: ${report.activeToday}\n\n`;
        msgText += `🆕 *آخر 5 انضمامات:*\n`;

        recent.forEach(u => {
            msgText += `- ${u.firstName} (@${u.username || 'NoUser'})\n`;
        });

        await bot.editMessageText(msgText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[{ text: '🔙 رجوع', callback_data: 'admin_panel' }]]
            }
        });
        return;
    }

    // 15. No-op
    if (data === 'noop') {
        await bot.answerCallbackQuery(query.id);
        return;
    }
});

// Handle Text Messages (for Admin Input)
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    if (!userStates[userId]) return;

    const state = userStates[userId];

    if (state.action === 'awaiting_title') {
        state.tempTitle = text;
        state.action = 'awaiting_content';
        await bot.sendMessage(chatId, `✅ العنوان: ${text}\n\nالآن أرسل محتوى الشرح لهذا القسم:`);
    } else if (state.action === 'awaiting_content') {
        const title = state.tempTitle;
        const content = text;

        db.addSection(title, content);

        delete userStates[userId]; // Clear state
        await bot.sendMessage(chatId, '✅ تم إضافة القسم بنجاح!', {
            reply_markup: {
                inline_keyboard: [[{ text: '⚙️ العودة للوحة التحكم', callback_data: 'admin_panel' }]]
            }
        });
    } else if (state.action === 'awaiting_edit_content') {
        // Handle Section Editing
        if (text) {
            const success = db.updateSection(state.sectionId, text);
            delete userStates[userId];

            if (success) {
                await bot.sendMessage(chatId, '✅ تم تحديث نص القسم بنجاح!', {
                    reply_markup: {
                        inline_keyboard: [[{ text: '⚙️ العودة للوحة التحكم', callback_data: 'admin_panel' }]]
                    }
                });
            } else {
                await bot.sendMessage(chatId, '❌ فشل التحديث: القسم غير موجود.', {
                    reply_markup: {
                        inline_keyboard: [[{ text: '⚙️ العودة للوحة التحكم', callback_data: 'admin_panel' }]]
                    }
                });
            }
        }
    }
});

// Helper: Log Channel ID
bot.on('channel_post', (msg) => {
    console.log(`📢 Channel Post received! Channel ID: ${msg.chat.id}`);
    console.log(`   Title: ${msg.chat.title}`);
});

console.log('Bot is running...');
// console.log('Admin ID:', adminId);
if (!requiredChannelId) {
    console.log('⚠️ No REQUIRED_CHANNEL_ID set in .env. Mandatory subscription is disabled.');
    console.log('   To enable, send a message to the channel and check the logs for "Channel ID".');
}
