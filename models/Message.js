const { model, Schema, ObjectId } = require('mongoose')

const MessageSchema = new Schema({
    sender: {
        type: ObjectId,
        required: true
    },
    text: {
        type: String,
        required: true
    },
    is_deleted: {
        type: Boolean,
        default: false
    },
    is_public: {
        type: Boolean,
        required: true
    },
    chat: ObjectId
    },
    {
        timestamps: true
    })

module.exports = {
    model: model('Message', MessageSchema),
    schema: MessageSchema
}