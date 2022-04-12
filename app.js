const express = require('express')
const exphbs = require('express-handlebars')
const session = require('express-session')
const cookieParser = require('cookie-parser')
const nodemailer = require('nodemailer')
const dateFormat = require('dateformat')
const mongoose = require('mongoose')
const MongoStore = require('connect-mongodb-session')(session)
const WebSocket = require('ws')

const User = require('./models/User').model
const Message = require('./models/Message').model
const Chat = require('./models/Chat').model

let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER || require('./gmail-auth').user,
        pass: process.env.GMAIL_PASS || require('./gmail-auth').pass
    },
})

let connected_to_server = []
let users_to_rooms = []

const app = express()
const MongoURI =  process.env.MONGODB_URI || `mongodb://localhost/chat`
const server = require('http').createServer(app)

const hbs = exphbs.create({
    defaultLayout: 'main',
    extname: 'hbs',
    helpers: require('./handlebars-helpers').helpers
})

app.engine('hbs', hbs.engine)
app.set('view engine', 'hbs')
app.set('views', 'views')
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static('./public'))

const store = new MongoStore({
    collection: 'sessions',
    uri: MongoURI
})

//app.use(cookieParser());

let sessionParser = session({
    secret: process.env.SECRET_KEY_SESSIONS || require('./secret'),
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 3600000,
        expires: new Date(Date.now() + 3600000),
    },
    store: store
})

app.use(sessionParser)

app.use((req, res, next) => {
    if (req.session.user_id) {
        res.locals.user_authed = true
    }
    next()
})

async function checkAuth(req, res, next) {
    if (req.session.user_id) {
        next()
    } else {
        if (req.session.messages) {
            req.session.messages.push({
                type: "error",
                text: "Сначала войдите в аккаунт"
            })
        } else {
            req.session.messages = [
                {
                    type: "error",
                    text: "Сначала войдите в аккаунт"
                }
            ]
        }
        res.redirect('/login')
    }
}

function checkNotAuth(req, res, next) {
    if (!req.session.user_id) {
        next()
    } else {
        res.redirect('/')
    }
}

function messagesToLocals(req, res, next) {
    res.locals.messages = req.session.messages
    delete req.session.messages
    next()
}

app.use(messagesToLocals)

const ws = new WebSocket.Server({server})

app.get('/', (req, res) => {
    res.render('index')
})

app.get('/register', checkNotAuth, (req, res) => {
    let context = {}
    if (req.session.form_info) {
        context.form_info = req.session.form_info
        delete req.session.form_info
    }
    res.render('register', context)
})

app.post('/register', checkNotAuth, async (req, res) => {
    req.session.messages = []
    if (req.body.password != req.body.password_repeat) {
        req.session.messages.push({
            type: "error",
            text: "Пароли не совпадают"
        })
        req.session.form_info = req.body
        return res.redirect('/register')
    }
    let user_with_email = await User.findOne({email: req.body.email})
    if (user_with_email) {
        req.session.form_info = req.body
        req.session.messages.push({
            type: "error",
            text: "Пользователь с такой почтой уже зарегистрирован!"
        })
        return res.redirect('/register')
    }
    let new_user = new User({
        first_name: req.body.first_name,
        last_name: req.body.last_name,
        email: req.body.email,
        patronymic: req.body.patronymic,
        password: req.body.password,
        color: req.body.color
    })
    try {
        await new_user.save()
    }
    catch (err) {
        console.log(err)
        for (let error in err.errors) {
            let text = ``
            if (err.errors[error].kind == 'required') {
                text += 'Заполните поле '
                switch(err.errors[error].path) {
                    case "email": text += '"Почта"'; break;
                    case "first_name": text += '"Имя"'; break;
                    case "last_name": text += '"Фамилия"'; break;
                    case "password": text += '"Пароль"'; break;
                }
            }
            req.session.messages.push({
                type: "error",
                text: text
            })

            req.session.form_info = req.body
            
        }
        return res.redirect('/register')
    }

    sendEmailForActivate(new_user._id)

    req.session.messages.push({
        type: "success",
        text: "Вы зарегистрированы! Активируйте свой аккаунт, перейдя по ссылке, которую мы вам отправили на почту"
    })
    
      
    return res.redirect('/login')
})

app.get('/login', checkNotAuth, (req, res) => {
    res.render('login')
    console.log(new Date(Date.now()))
})

app.post('/login', checkNotAuth, async (req, res) => {
    req.session.messages = []
    let user = await User.findOne({email: req.body.email})
    if (user == null) {
        req.session.messages.push({
            type: "error",
            text: `Невозможно войти с предоставленными учетными данными`
        })
        return res.redirect('/login')
    }
    user.comparePassword(req.body.password, function(err, isMatch) {
        if (err) return console.log(err)
        if (isMatch) {
            if (!user.is_active) {
                req.session.messages = [
                    {
                        type: "error",
                        text: "Проверьте почту и активируйте свой аккаунт"
                    }
                ]
                return res.redirect('/login')
            }
            req.session.user_id = user._id
            req.session.messages.push({
                type: "success",
                text: `Вы успешно вошли! Добро пожаловать, ${user.last_name} ${user.first_name}`
            })
            return res.redirect('/')
        } else {
            req.session.messages.push({
                type: "error",
                text: `Невозможно войти с предоставленными учетными данными`
            })
            return res.redirect('/login')
        }
    })
})

app.get('/logout', checkAuth, (req, res) => {
    delete req.session.user_id
    req.session.messages = [
        {
            type: "success",
            text: "Вы вышли из аккаунта"
        }
    ]
    res.redirect('/')
})

app.get('/profile/edit', checkAuth, async (req, res) => {
    let cur_user = await User.findById(req.session.user_id)
    let context = {}
    context.user = {
        last_name: cur_user.last_name,
        first_name: cur_user.first_name,
        patronymic: cur_user.patronymic,
        color: cur_user.color
    }
    res.render('edit_profile', context)
})

app.post('/profile/edit', checkAuth, async (req, res) => {
    let cur_user = await User.findById(req.session.user_id)
    cur_user.last_name = req.body.last_name
    cur_user.first_name = req.body.first_name
    cur_user.patronymic = req.body.patronymic
    cur_user.color = req.body.color
    await cur_user.save()
    req.session.messages = []
    req.session.messages.push({
        type: "success",
        text: "Профиль успешно обновлён!"
    })
    res.redirect('/profile')
})

app.get('/chat', checkAuth, async (req, res) => {
    let prev_chat
    for (let user of users_to_rooms) {
        if (String(user.user_id) == String(req.session.user_id)) {
            prev_chat = user.chat
            users_to_rooms.splice(users_to_rooms.indexOf(user), 1)
        }
    }
   
    users_to_rooms.push({
        user_id: req.session.user_id,
        chat: 'main',
        prev_chat
    })
    let context = {}
    context.msg = []
    let all_messages = await Message.find({chat: undefined})
    for (let message of all_messages) {
        let author = await User.findById(message.sender)
        context.msg.push({
            sender: author.last_name + ' ' + author.first_name,
            sender_color: author.color,
            text: message.text,
            time: dateFormat(message.createdAt, "HH:MM:ss dd.mm.yyyy"),
            is_deleted: message.is_deleted
        })
    }
    let cur_user = await User.findById(req.session.user_id)
    context.cur_user = {}
    context.cur_user.first_name = cur_user.first_name
    context.cur_user.last_name = cur_user.last_name
    context.cur_user.patronymic = cur_user.patronymic
    context.cur_user.id = cur_user._id
    context.cur_user.color = cur_user.color
    res.render('chat', context)
})

app.post('/message/:text', checkAuth, async (req, res) => {
    let new_message = new Message({
        sender: req.session.user_id,
        text: req.params.text,
        is_public: true
    })
    await new_message.save()
    let author = await User.findById(req.session.user_id)
    for (let user of users_to_rooms) {
        if (user.chat == 'main') {
            for (let usr of connected_to_server) {
                if (String(usr.user_id) == String(user.user_id)) {
                    usr.socket.send(JSON.stringify({
                        type: "New message",
                        sender: author.last_name + ' ' + author.first_name,
                        sender_color: author.color,
                        text: new_message.text.replace(/(<a href=")?((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)))(">(.*)<\/a>)?/gi, function () {
                            return '<a target="_blank" href="' + arguments[2] + '">' + (arguments[7] || arguments[2]) + '</a>'
                        }),
                        time: dateFormat(new_message.createdAt, "HH:MM:ss dd.mm.yyyy")
                    }))
                }
            }
        }
    }
    res.end('ok')
})

app.post('/message/:id/delete', checkAuth, async (req, res) => {
    let req_msg = await Message.findById(req.params.id)
    if (req_msg == undefined) {
        return res.end('Not found')
    }
    if (String(req_msg.sender) != req.session.user_id) {
        for (let client of connected_to_server) {
            if (client.user_id == req.body.user_id) {
                client.socket.send({
                    type: "Message to user",
                    text: "Вы не можете удалить чужое сообщение"
                })
            }
        }
        return res.end('Error')
    }
    req_msg.is_deleted = true
    req_msg.text = "Deleted"
    await req_msg.save()
    for (let client of connected_to_server) {
        if (client.user_id == req.body.user_id) {
            client.socket.send({
                type: "Message to user",
                text: "Сообщение удалено"
            })
        }
    }
    res.end('ok')
})

app.get('/profile', checkAuth, async (req, res) => {
    let cur_user = await User.findById(req.session.user_id)
    let context = {
        first_name: cur_user.first_name,
        last_name: cur_user.last_name,
        patronymic: cur_user.patronymic,
        email: cur_user.email,
        color: cur_user.color
    }
    res.render('profile', context)
})

app.get('/profile/activate/:key_link', async (req, res) => {
    let find_usr = await User.findOne({activate_link: req.params.key_link})
    if (find_usr == undefined) {
        return res.end('Not found')
    }
    find_usr.is_active = true
    find_usr.activate_link = ""
    find_usr.save()
    let context = {
        first_name: find_usr.first_name,
        last_name: find_usr.last_name,
        patronymic: find_usr.patronymic,
        email: find_usr.email
    }
    res.render('activate_email', context)
})

app.get('/chat/add', checkAuth, (req, res) => {
    let context = {}
    if (req.session.form_info) {
        context.form_info = req.session.form_info
        delete req.session.form_info
    }
    res.render('add_chat', context)
})

app.post('/chat/add', checkAuth, async (req, res) => {
    req.session.messages = []
    let new_chat = new Chat({
        name: req.body.name,
        description: req.body.description,
        users: [req.session.user_id],
        admins: [req.session.user_id],
        creator: req.session.user_id
    })
    try {
        await new_chat.save()
    } catch(err) {
        console.log(err)
        for (let error in err.errors) {
            let text = ``
            if (err.errors[error].kind == 'required') {
                text += 'Заполните поле '
                switch(err.errors[error].path) {
                    case "name": text += '"Название чата"'; break;
                }
            }
            req.session.messages.push({
                type: "error",
                text: text
            })

            req.session.form_info = req.body
        }
        res.redirect('/chat/add')
    }
    req.session.messages.push({
        type: "success",
        text: "Чат успешно создан"
    })
    res.redirect('/chat/' + new_chat._id + '/view')
})

app.get('/chat/:id/edit', checkAuth, async (req, res) => {
    let chat = await Chat.findById(req.params.id)
    if (chat == undefined) {
        req.session.messages = [
            {
                type: "error",
                text: "Такого чата не существует"
            }
        ]
        return res.redirect('/chat/list/')
    }
    if (chat.admins.indexOf(req.session.user_id) == -1) {
        req.session.messages = [
            {
                type: "error",
                text: "Вы не явялетесь администратором этого чата"
            }
        ]
        return res.redirect('/chat/' + req.params.id + '/view')
    }
    let context = {
        chat_id: chat._id,
        chat_name: chat.name,
        chat_description: chat.description,
    }
    context.chat_users = []
    let i = 1;
    for (let usr of chat.users) {
        let user = await User.findById(usr)
        context.chat_users.push({
            number: i,
            name: user.last_name + ' ' + user.first_name,
            count_of_messages: (await Message.find({
                sender: user._id,
                chat: chat._id,
            })).length,
            user_id: user._id,
            is_admin: Boolean(chat.admins.indexOf(user._id) != -1)
        })
        i++
    }
    res.render('edit_chat', context)
})

app.post('/chat/:id/edit', checkAuth, async (req, res) => {
    let chat = await Chat.findById(req.params.id)
    if (chat == undefined) {
        req.session.messages = [
            {
                type: "error",
                text: "Такого чата не существует"
            }
        ]
        return res.redirect('/chat/list/')
    }
    if (chat.admins.indexOf(req.session.user_id) == -1) {
        req.session.messages = [
            {
                type: "error",
                text: "Вы не явялетесь администратором этого чата"
            }
        ]
        return res.redirect('/chat/' + req.params.id + '/view')
    }
    chat.name = req.body.name
    chat.description = req.body.description
    await chat.save()
    req.session.messages = [
        {
            type: "success",
            text: "Настройки сохранены"
        }
    ]
    res.redirect('/chat/' + chat._id + '/view')
})

app.post('/chat/:id/add', checkAuth, async (req, res) => {
    let chat = await Chat.findById(req.params.id)
    if (chat == undefined) {
        req.session.messages = [
            {
                type: "error",
                text: "Такого чата не существует"
            }
        ]
        return res.redirect('/chat/list/')
    }
    if (chat.admins.indexOf(req.session.user_id) == -1) {
        req.session.messages = [
            {
                type: "error",
                text: "Вы не явялетесь администратором этого чата"
            }
        ]
        return res.redirect('/chat/' + req.params.id + '/view')
    }
    let add_user = await User.findOne({email: req.body.email})
    if (add_user == undefined) {
        req.session.messages = [
            {
                type: "error",
                text: "Такого пользователя не существует"
            }
        ]
        return res.redirect('/chat/' + chat._id + '/edit/')
    }
    if (chat.users.indexOf(add_user._id) != -1) {
        req.session.messages = [
            {
                type: "error",
                text: "Пользователь уже состоит в чате"
            }
        ]
        return res.redirect('/chat/' + chat._id + '/edit/')
    }
    chat.users.push(add_user._id)
    if (req.body.admin == 'on') {
        chat.admins.push(add_user._id)
    }
    await chat.save()
    req.session.messages = [
        {
            type: "success",
            text: `${add_user.last_name} ${add_user.first_name} добавлен в чат. Количество участников: ${chat.users.length}`
        }
    ]
    res.redirect('/chat/' + chat._id + '/edit')
})

app.get('/chat/:id/view', checkAuth, async (req, res) => {
    let cur_chat = await Chat.findById(req.params.id)
    if (cur_chat.users.indexOf(req.session.user_id) == -1) {
        req.session.messages = [
            {
                type: "error",
                text: "У вас нет такого чата!"
            }
        ]
        return res.redirect('/chat/list')
    }
    let msg = await Message.find({chat: cur_chat._id})
    let msg_lst = []
    for (let m of msg) {
        let sender = await User.findById(m.sender)
        msg_lst.push({
            sender: sender.last_name + ' ' + sender.first_name,
            sender_color: sender.color,
            text: m.text,
            time: dateFormat(m.createdAt, "HH:MM")
        })
    }
    let context = {
        chat_name: cur_chat.name,
        msg: msg_lst,
        chat_users: cur_chat.users.length,
        is_admin: false,
        chat_id: cur_chat._id,
    }
    if (cur_chat.admins.indexOf(req.session.user_id) != -1) {
        context.is_admin = true
    }
    let prev_chat
    for (let user of users_to_rooms) {
        if (String(user.user_id) == String(req.session.user_id)) {
            prev_chat = user.chat
            users_to_rooms.splice(users_to_rooms.indexOf(user), 1)
        }
    }
    users_to_rooms.push({
        user_id: req.session.user_id,
        chat: req.params.id,
        prev_chat
    })
    
    res.render('view_chat', context)
})

app.post('/chat/:id/add/admin/:user_id', async (req, res) => {
    let chat = await Chat.findById(req.params.id)
    if (chat.admins.indexOf(req.session.user_id) == -1) {
        return res.end("You're not admin")
    } else if (chat.users.indexOf(req.params.user_id) == -1) {
        return res.end("There isn't this user in this chat")
    }
    chat.admins.push(req.params.user_id)
    await chat.save()
    res.end('ok')
})

app.post('/chat/:id/delete/admin/:user_id', async (req, res) => {
    let chat = await Chat.findById(req.params.id)
    if (chat.admins.indexOf(req.session.user_id) == -1) {
        req.session.messages = [
            {
                type: "error",
                text: "Вы не являетесь администратором этого чата"
            }
        ]
        return res.end("Error")
    } else if (chat.admins.indexOf(req.params.user_id) == -1) {
        req.session.messages = [
            {
                type: "error",
                text: "Такого администратора в чате нет"
            }
        ]
        return res.end("Error")
    } else if (req.params.user_id == req.session.user_id) {
        req.session.messages = [
            {
                type: "error",
                text: "Вы не можете удалить из администраторов сами себя"
            }
        ]
        return res.end("Error")
    } else if (String(chat.creator) != String(req.session.user_id)) {
        req.session.messages = [
            {
                type: "error",
                text: "Только создатель может забирать права на администрирование чата"
            }
        ]
        return res.end("Error")
    }
    chat.admins.splice(chat.admins.indexOf(req.params.user_id), 1)
    await chat.save()
    res.end('ok')
})

app.post('/chat/:id/delete/user/:user_id', async (req, res) => {
    let chat = await Chat.findById(req.params.id)
    if (chat.admins.indexOf(req.session.user_id) == -1) {
        req.session.messages = [
            {
                type: "error",
                text: "Вы не являетесь администратором этого чата"
            }
        ]
        return res.end("Error")
    } else if (chat.users.indexOf(req.params.user_id) == -1) {
        req.session.messages = [
            {
                type: "error",
                text: "Такого пользователя в чате нет"
            }
        ]
        return res.end("Error")
    } else if (req.params.user_id == req.session.user_id) {
        req.session.messages = [
            {
                type: "error",
                text: "Вы не можете удалить сами себя"
            }
        ]
        return res.end("Error")
    } else if (String(chat.creator) != String(req.session.user_id) && chat.admins.indexOf(req.params.user_id) != -1) {
        req.session.messages = [
            {
                type: "error",
                text: "Только создатель может удалить администратора"
            }
        ]
        return res.end("Error")
    }
    chat.users.splice(chat.users.indexOf(req.params.user_id), 1)
    await chat.save()
    res.end('ok')
})

app.post('/chat/message/:text', async (req, res) => {
    let chat_id
    for (let user of users_to_rooms) {
        if (String(user.user_id) == String(req.session.user_id)) {
            chat_id = user.chat
        }
    }
    let new_message = new Message({
        sender: req.session.user_id,
        text: req.params.text,
        is_public: false,
        chat: chat_id
    })
    await new_message.save()
    let author = await User.findById(req.session.user_id)
    for (let user of users_to_rooms) {
        if (user.chat == chat_id) {
            for (let usr of connected_to_server) {
                if (String(usr.user_id) == String(user.user_id)) {
                    usr.socket.send(JSON.stringify({
                        type: "New message",
                        sender: author.last_name + ' ' + author.first_name,
                        sender_color: author.color,
                        text: new_message.text.replace(/(<a href=")?((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)))(">(.*)<\/a>)?/gi, function () {
                            return '<a class="styled-a" target="_blank" href="' + arguments[2] + '">' + (arguments[7] || arguments[2]) + '</a>'
                        }),
                        time: dateFormat(new_message.createdAt, "HH:MM")
                    }))
                    break
                }
            }
        }
    }
    res.end('ok')
})

ws.on('connection', function(socket, httpRequest) {
    console.log("Подключился клиент")
    sessionParser(httpRequest, {}, async function() {
        let user_id = httpRequest.session.user_id
        if (user_id == undefined) {
            return socket.close()
        }
        connected_to_server.push({user_id, socket})
        sendOnlineChat(user_id)
    })

    socket.on('close', function () {
        console.log("Клиент отключился")
        sessionParser(httpRequest, {}, function() {
            let user_id = httpRequest.session.user_id
            if (user_id == undefined) {
                return socket.close()
            }
            for (let user of connected_to_server) {
                if (String(user.user_id) == String(user_id)) {
                    connected_to_server.splice(connected_to_server.indexOf(user), 1)
                }
            }
            /*for (let user of users_to_rooms) {
                if (String(user.user_id) == String(user_id)) {
                    users_to_rooms.splice(users_to_rooms.indexOf(user), 1)
                }
            }*/
            sendOnlineChat(user_id)
        })
    })
})

app.get('/chat/list', checkAuth, async (req, res) => {
    let context = {}
    context.chats = []
    let chats = await Chat.find()
    for (let chat of chats) {
        if (chat.users.indexOf(req.session.user_id) != -1) {
            context.chats.push({
                name: chat.name,
                count_of_users: chat.users.length,
                link: `/chat/${chat._id}/view`
            })
        }
    }
    if (context.chats.length != 0) {
        context.isChat = true
    }
    res.render('user_chats', context)
})

async function sendOnlineChat(user_id) {
    let online_users = []
    let prev_online_users = []
    let cur_user
    
    for (let user of users_to_rooms) {
        if (String(user.user_id) == String(user_id)) {
            cur_user = user
        }
    }
    if (cur_user.prev_chat == 'main') {
        sendOnline()
    } else {
        for (let user of users_to_rooms) {
            if (String(user.chat) == String(cur_user.prev_chat)) {
                for (let usr of connected_to_server) {
                    if (String(usr.user_id) == String(user.user_id)) {
                        let src_user = await User.findById(user.user_id)
                        let snd_user = {}
                        snd_user.first_name = src_user.first_name
                        snd_user.last_name = src_user.last_name
                        snd_user.color = src_user.color
                        prev_online_users.push(snd_user)
                    }
                }
            }
        }

        for (let user of users_to_rooms) {
            if (String(user.chat) == String(cur_user.prev_chat)) {
                for (let usr of connected_to_server) {
                    if (String(user.user_id) == String(usr.user_id)) {
                        usr.socket.send(JSON.stringify({
                            type: "Count of users",
                            count_of_users: (await Chat.findById(cur_user.prev_chat)).users.length,
                            prev_online_users
                        }))
                        break
                    }
                }
            }
        }
    }

    if (cur_user.chat == 'main') {
        return sendOnline()
    }

    for (let user of users_to_rooms) {
        if (String(user.chat) == String(cur_user.chat)) {
            for (let usr of connected_to_server) {
                if (String(usr.user_id) == String(user.user_id)) {
                    let src_user = await User.findById(user.user_id)
                    let snd_user = {}
                    snd_user.first_name = src_user.first_name
                    snd_user.last_name = src_user.last_name
                    snd_user.color = src_user.color
                    online_users.push(snd_user)
                }
            }
        }
    }

    

    
    for (let user of users_to_rooms) {
        if (String(user.chat) == String(cur_user.chat)) {
            for (let usr of connected_to_server) {
                if (String(user.user_id) == String(usr.user_id)) {
                    usr.socket.send(JSON.stringify({
                        type: "Count of users",
                        count_of_users: (await Chat.findById(cur_user.chat)).users.length,
                        online_users
                    }))
                    break
                }
            }
        }
    }

    
}

async function sendOnline() {
    let users_online = []
    for (let client of connected_to_server) {
        let user = await User.findById(client.user_id)
        if (user == undefined) {
            for (let user2 of connected_to_server) {
                if (String(user2.user_id) == String(user.id)) {
                    connected_to_server.splice(connected_to_server.indexOf(user2), 1)
                }
            }
            continue
        }
        for (let usr of users_to_rooms) {
            if (String(usr.user_id) == String(user.id) && usr.chat == 'main') {
                users_online.push({
                    last_name: user.last_name,
                    first_name: user.first_name,
                    color: user.color
                })
            }
        }
    }
    ws.clients.forEach(client => {
        client.send(JSON.stringify({
            type: "Online list",
            users: users_online
        }))
    })
}

mongoose.connect(MongoURI, () => {
    console.log('Соединение с MongoDB установлено')
    listener = server.listen(process.env.PORT || 3000, () => {
        console.log(`Сервер запущен на ${process.env.PORT} порту`)
    })
})

async function sendEmailForActivate(user_id) {
    let user = await User.findById(user_id)
    if (user.is_active) {
        return console.log("Попытка отправить письмо для активации пользователю с уже подтвержденным email!")
    }
    try {
        await transporter.sendMail({
            from: `"Chat System" <${process.env.GMAIL_USER || 'baxrev.vlad@gmail.com'}>`,
            to: user.email,
            subject: 'Вы успешно зарегистрировались',
            text: 'Вы зарегистрировались на сайте чата. Для активации аккаунта перейдите по ссылке',
            html:
            `<h1 style="text-align: center">Поздравляем!</h1><p style="text-align: center;">Вы <i>зарегистрировались</i> на <b>сайте чата</b>. Для активации аккаунта перейдите по ссылке: </p><a href="${process.env.HEROKU_URL || '192.168.1.65:5000/'}profile/activate/${user.activate_link}" style="color: #333333; font: 10px Arial, sans-serif; line-height: 30px; -webkit-text-size-adjust:none; display: block;" target="_blank">${process.env.HEROKU_URL || '192.168.1.65:5000/'}profile/activate/${user.activate_link}</a>`,
        })
    } catch (err) {
        return console.log(err)
    }
}