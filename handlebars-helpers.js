const hbs = require('hbs')
let register = function (Handlebars) {
    let helpers = {
        format_link: function(text) {
            let result = text.replace(/(<a href=")?((https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)))(">(.*)<\/a>)?/gi, function () {
                return '<a class="styled-a" target="_blank" href="' + arguments[2] + '">' + (arguments[7] || arguments[2]) + '</a>'
            })
            return new hbs.SafeString(result);
        }
    }

    if (Handlebars && typeof Handlebars.registerHelper === "function") {
        for (var prop in helpers) {
            Handlebars.registerHelper(prop, helpers[prop]);
        }
    } else {
        return helpers;
    }

};

module.exports.register = register;
module.exports.helpers = register(null);