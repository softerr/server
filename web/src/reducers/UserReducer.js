const UserReducer = (state = {}, action) => {
    switch (action.type) {
        case "SIGN_IN":
            const token = action.token;
            const payload = JSON.parse(atob(token.split(".")[1]));
            return { token: token, id: payload.sub, username: payload.username, roles: payload.roles };
        case "SIGN_OUT":
            return {};
        default:
            return state;
    }
};

export default UserReducer;
