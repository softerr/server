const UsersReducer = (state = { users: [] }, action) => {
    switch (action.type) {
        case "USERS_SET":
            return { users: action.users };
        case "USERS_DEL":
            const users = state.users.filter(user => user.id !== action.id);
            console.log(users);
            return { users: users };
        default:
            return state;
    }
};

export default UsersReducer;
