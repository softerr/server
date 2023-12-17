const PublicQuizzesReducer = (state = { quizzes: [] }, action) => {
    switch (action.type) {
        case "PUBLIC_QUIZZES_SET":
            return { quizzes: action.quizzes };
        default:
            return state;
    }
};

export default PublicQuizzesReducer;
