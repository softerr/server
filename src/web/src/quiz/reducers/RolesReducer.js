const RolesReducer = (state = { roles: [] }, action) => {
    switch (action.type) {
        case "ROLES_SET":
            return { roles: action.roles };
        default:
            return state;
    }
};

export default RolesReducer;
