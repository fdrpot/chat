const express = require('express')
const exphbs = require('express-handlebars')
const session = require('express-session')
const cookieParser = require('cookie-parser')
const nodemailer = require('nodemailer')
const mongoose = require('mongoose')
const MongoStore = require('connect-mongodb-session')(session)
const WebSocket = require('ws')

const User = require('./models/User')
const Message = require('./models/Message')

let transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: require('./gmail-auth'),
})

const app = express()
const MongoURI = `mongodb://localhost/chat`

const hbs = exphbs.create({
    defaultLayout: 'main',
    extname: 'hbs'
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

app.use(cookieParser());
app.use(session({
    secret: require('./secret'),
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 3600000,
        expires: new Date(Date.now() + 3600000),
    },
    store: store
}))

app.use((req, res, next) => {
    if (req.session.user_id) {
        res.locals.user_authed = true
    }
    next()
})

function checkAuth(req, res, next) {
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

const server = new WebSocket.Server({
    port: 3001
})

app.get('/', (req, res) => {
    res.render('index')
})

app.get('/register', checkNotAuth, (req, res) => {
    let context = {}
    if (req.session.form_info) {
        context.form_info = req.session.form_info
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
    req.session.messages.push({
        type: "success",
        text: "Вы зарегистрированы! Можете использовать свою почту и пароль для входа"
    })
    let result = await transporter.sendMail({
        from: '"Chat System" <baxrev.vlad@gmail.com>',
        to: req.body.email,
        subject: 'Вы успешно зарегистрировались',
        text: 'Вы зарегистрировались на сайте чата.',
        html:
          'Вы <i>зарегистрировались</i> на <b>сайте чата</b>.',
    })
      
    console.log(result)
    return res.redirect('/login')
})

app.get('/login', checkNotAuth, (req, res) => {
    res.render('login')
    console.log(new Date(Date.now()))
})

app.post('/login', checkNotAuth, async (req, res) => {
    req.session.messages = []
    let user = await User.findOne({email: req.body.email})
    user.comparePassword(req.body.password, function(err, isMatch) {
        if (err) return console.log(err)
        if (isMatch) {
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
    res.redirect('/')
})

app.get('/chat', checkAuth, async (req, res) => {
    let context = {}
    context.msg = []
    let all_messages = await Message.find()
    for (let message of all_messages) {
        let author = await User.findById(message.sender)
        context.msg.push({
            sender: author.last_name + ' ' + author.first_name,
            sender_color: author.color,
            text: message.text
        })
    }
    res.render('chat', context)
})

app.post('/message/:text', checkAuth, async (req, res) => {
    let new_message = new Message({
        sender: req.session.user_id,
        text: req.params.text
    })
    await new_message.save()
    let author = await User.findById(req.session.user_id)
    server.clients.forEach(client => {
        client.send(JSON.stringify({
            type: "New message",
            sender: author.last_name + ' ' + author.first_name,
            sender_color: author.color,
            text: req.params.text
        }))
    })
    res.end('ok')
})

server.on('connection', function(ws) {
    console.log("Подключился клиент")
})

mongoose.connect(MongoURI, () => {
    console.log('Соединение с MongoDB установлено')
    app.listen(3000, () => {
        console.log('Сервер запущен на 3000 порту')
    })
})