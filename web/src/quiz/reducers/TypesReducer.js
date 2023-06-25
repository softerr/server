const TypesReducer = (state = { types: [] }, action) => {
    switch (action.type) {
        case "TYPES_SET":
            return { types: action.types };
        default:
            return state;
    }
};

export default TypesReducer;
