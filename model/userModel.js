const mongoose=require('mongoose') ;

const userSchema=new mongoose.Schema({
    email:{
        type: String,
        required: true, 
        unique: true,
        match: /.+\@.+\..+/,
        lowercase: true,
        trim: true
    } ,
    isEmailVerified: {
        type: Boolean,
        default: false
    },
    emailVerificationToken: String,
    emailVerificationExpires: Date,
    name: {
        type: String,
        required: true,    
    } ,  
    username: {
        type: String,
        required: true,
        unique: true,
    },
    phone: {
        type: String,
        required: false, // Optional for Google OAuth users
    },
    password: {
        type: String,
        required: false, // Optional for Google OAuth users
    },
    role: {
        type: String,
        enum: ['buyer', 'seller'],
        default: 'buyer'
    },
    profilePicture: {
        type: String,
        required: false,
    },
    authProvider: {
        type: String,
        enum: ['email', 'google'],
        default: 'email'
    },
    stripeAccountId: {
        type: String,
        required: false, // For sellers to receive payments
    },
    stripeCustomerId: {
        type: String,
        required: false,
        index: true,
    },
    addresses: [
        {
            label: { type: String }, // e.g., Home, Warehouse
            street: { type: String },
            addressLine2: { type: String },
            area: { type: String },
            city: { type: String },
            state: { type: String },
            postalCode: { type: String },
            country: { type: String, default: 'Pakistan' },
            latitude: { type: Number },
            longitude: { type: Number },
            isDefault: { type: Boolean, default: false }
        }
    ]
})

const User = mongoose.model('User', userSchema);
module.exports = User;