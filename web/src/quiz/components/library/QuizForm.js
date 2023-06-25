import { useEffect, useRef, useState } from "react";
import { Button, Col, Form, Row } from "react-bootstrap";
import { useDispatch, useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { createOrUpdateQuiz } from "../../services";

const QuizForm = ({ quiz, onSave, onCancel }) => {
    const cachedUser = useSelector(state => state.user);
    const nameRef = useRef(null);
    const descriptionRef = useRef(null);
    const publicRef = useRef(null);
    const [formErrors, setFormErrors] = useState({});
    const navigate = useNavigate();
    const dispatch = useDispatch();

    useEffect(() => {
        nameRef.current.value = quiz.name;
        descriptionRef.current.value = quiz.description;
        publicRef.current.checked = quiz.public;
    }, []);

    const handleSubmit = e => {
        e.preventDefault();
        const name = nameRef.current.value;
        const description = descriptionRef.current.value;
        const isPublic = publicRef.current.checked;

        const errors = {};

        if (!name) {
            errors.name = "Name ir required";
        } else if (name.trim().length !== name.length) {
            errors.name = "Name cannot start or end with a space";
        }

        if (!description) {
        } else if (description.trim().length !== description.length) {
            errors.description = "Description cannot start or end with a space";
        }

        setFormErrors(errors);
        if (Object.keys(errors).length === 0) {
            createOrUpdateQuiz(cachedUser.token, quiz.user_id, quiz.id, { name, description, public: isPublic },
                data => {
                    dispatch({ type: quiz.id ? "USER_QUIZZES_SET_QUIZ" : "USER_QUIZZES_ADD", quiz: data, userId: data.user_id });
                    onSave(data);
                },
                res => {
                    if (res.status === 401) {
                        dispatch({ type: "SIGN_OUT" });
                        navigate("/quiz/login");
                    } else {
                        console.log(res);
                    }
                }
            );
        }
    };

    return (
        <Form onSubmit={handleSubmit} noValidate>
            <Form.Group className="mb-3">
                <Form.Label>Name</Form.Label>
                <Form.Control type="text" placeholder="Enter name" ref={nameRef} isInvalid={!!formErrors.name}></Form.Control>
                <Form.Control.Feedback type="invalid">{formErrors.name}</Form.Control.Feedback>
            </Form.Group>
            <Form.Group className="mb-3">
                <Form.Label>Description (optional)</Form.Label>
                <Form.Control as="textarea" type="text" placeholder="Enter description" ref={descriptionRef} isInvalid={!!formErrors.description}></Form.Control>
                <Form.Control.Feedback type="invalid">{formErrors.description}</Form.Control.Feedback>
            </Form.Group>
            <Form.Check type={"checkbox"} label={"Public"} ref={publicRef} />
            <div className="d-flex justify-content-end">
                <Row className="justify-content-end">
                    {!quiz.id && (
                        <Col xs={"auto"}>
                            <Button variant="primary" as={Link} to={onCancel}>
                                Cancel
                            </Button>
                        </Col>
                    )}

                    <Col xs={"auto"}>
                        <Button variant="primary" type="submit">
                            {quiz.id ? "Save" : "Create"}
                        </Button>
                    </Col>
                </Row>
            </div>
        </Form>
    );
};

export default QuizForm;
