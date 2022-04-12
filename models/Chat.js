const { model, Schema, ObjectId } = require('mongoose')
const UserSchema = require('./User').schema

const ChatSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    description: String,
    users: {
        type: [ObjectId],
        required: true
    },
    admins: {
        type: [ObjectId],
        required: true
    },
    creator: ObjectId
},{
    timestamps: true
})

module.exports = {
    model: model('Chat', ChatSchema),
    schema: ChatSchema
}