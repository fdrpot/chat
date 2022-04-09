const { model, Schema, ObjectId } = require('mongoose')

const MessageSchema = new Schema({
    sender: {
        type: ObjectId,
        required: true
    },
    text: {
        type: String,
        required: true
    }
})

module.exports = model('Message', MessageSchema)