import { useEffect, useRef, useState } from "react";
import { Button, Container, Form, Spinner } from "react-bootstrap";
import { useNavigate, useParams } from "react-router-dom";
import NotFound from "../../layouts/NotFound";
import { userBeginResetPassword, userResetPassword } from "../../../users/services";

const ActivateAccount = () => {
    const { token } = useParams();
    const navigate = useNavigate();
    const [{ failed, resetToken, formErrors }, setState] = useState({ failed: false, formErrors: {} });
    const passwordRef = useRef(null);
    const repeatPasswordRef = useRef(null);

    useEffect(() => {
        userBeginResetPassword(token,
            data => data.token ?
                setState({ failed: false, resetToken: data.token, formErrors: {} }) :
                setState({ failed: true, formErrors: {} }),
            () => setState({ failed: true, formErrors: {} })
        );
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSubmit = e => {
        e.preventDefault();
        const password = passwordRef.current.value;
        const repeatPassword = repeatPasswordRef.current.value;

        const errors = {};

        if (!password) {
            errors.password = "Password ir required";
        } else if (password.trim().length !== password.length) {
            errors.password = "Password cannot start or end with a space";
        } else if (password.length < 8) {
            errors.password = "Password too short (must be at least 8 characters long)";
        }

        if (!repeatPassword) {
            errors.repeatPassword = "Password ir required";
        } else if (repeatPassword !== password) {
            errors.repeatPassword = "Passwords do not match";
        }

        if (Object.keys(errors).length === 0) {
            userResetPassword(resetToken, password,
                () => navigate("/quiz/login", { replace: true, state: { message: "Password was successfully changed." } }),
                res => console.log(res)
            );
        } else {
            setState({ failed: false, formErrors: errors });
        }
    };

    return failed ? (
        <NotFound />
    ) : resetToken ? (
        <Container fluid="sm" className="content px-3" style={{ maxWidth: "576px" }}>
            <Form onSubmit={handleSubmit} noValidate>
                <h1 className="text-center">Reset password</h1>
                <Form.Group className="mb-3">
                    <Form.Label>New Password</Form.Label>
                    <Form.Control type="password" placeholder="Enter password" ref={passwordRef} isInvalid={!!formErrors.password}></Form.Control>
                    <Form.Control.Feedback type="invalid">{formErrors.password}</Form.Control.Feedback>
                </Form.Group>
                <Form.Group className="mb-3">
                    <Form.Label>Repeat password</Form.Label>
                    <Form.Control type="password" placeholder="Enter password" ref={repeatPasswordRef} isInvalid={!!formErrors.repeatPassword}></Form.Control>
                    <Form.Control.Feedback type="invalid">{formErrors.repeatPassword}</Form.Control.Feedback>
                </Form.Group>
                <div className="d-grid">
                    <Button variant="primary" type="submit">
                        Reset
                    </Button>
                </div>
            </Form>
        </Container>
    ) : (
        <Container fluid="sm" className="d-flex justify-content-center" style={{ marginTop: "100px" }}>
            <Spinner animation="border" variant="primary" />
        </Container>
    );
};

export default ActivateAccount;
