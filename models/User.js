const { model, Schema } = require('mongoose')
const bcrypt = require('bcrypt')
const SALT_WORK_FACTOR = 10;

const UserSchema = new Schema({
    email: {
        type: String,
        required: true,
        index: {
            unique: true
        }
    },
    first_name: {
        type: String,
        required: true
    },
    last_name: {
        type: String,
        required: true
    },
    patronymic: String,
    password: {
        type: String,
        required: true
    },
    color: String,
    is_active: {
        type: Boolean,
        default: false
    },
    activate_link: String
})

UserSchema.pre('save', function(next) {
    let user = this
    if (!user.isModified('password')) return next()
    bcrypt.genSalt(SALT_WORK_FACTOR, function(err, salt) {
        if (err) return next(err)
        bcrypt.hash(user.password, salt, function(err, hash) {
            if (err) return next(err)
            user.password = hash
            let res_str = ''
            let characters = 'QWERTYUIOPASDFGHJKLZXCVBNM_1234567890qwertyuiopasdfghjklzxcvbnm'
            for (let i = 0; i < 70; i++) {
                res_str += characters.charAt(Math.floor(Math.random() * characters.length))
            }
            user.activate_link = res_str
            next()
        })
    })

})

UserSchema.methods.comparePassword = function(passForCheck, cb) {
    bcrypt.compare(passForCheck, this.password, function(err, isMatch) {
        if (err) return cb(err)
        cb(null, isMatch)
    })
}

module.exports = {
    model: model('User', UserSchema),
    shema: UserSchema
}