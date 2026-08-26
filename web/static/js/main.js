// Form handling
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('subscribe-form');
    const submitButton = document.getElementById('submit-button');
    const loadingSpinner = document.getElementById('loading-spinner');
    const successMessage = document.getElementById('success-message');
    let isSubmitting = false;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Prevent multiple submissions
        if (isSubmitting) return;
        isSubmitting = true;
        
        // Reset error messages
        document.querySelectorAll('.error-message').forEach(el => el.style.display = 'none');
        
        // Get form data
        const firstName = document.getElementById('first-name').value.trim();
        const lastName = document.getElementById('last-name').value.trim();
        const email = document.getElementById('email').value.trim();
        
        // Validate form
        let isValid = true;
        
        if (!firstName) {
            document.getElementById('first-name-error').textContent = 'First name is required';
            document.getElementById('first-name-error').style.display = 'block';
            isValid = false;
        }
        
        if (!lastName) {
            document.getElementById('last-name-error').textContent = 'Last name is required';
            document.getElementById('last-name-error').style.display = 'block';
            isValid = false;
        }
        
        if (!email) {
            document.getElementById('email-error').textContent = 'Email is required';
            document.getElementById('email-error').style.display = 'block';
            isValid = false;
        } else if (!isValidEmail(email)) {
            document.getElementById('email-error').textContent = 'Please enter a valid email address';
            document.getElementById('email-error').style.display = 'block';
            isValid = false;
        }
        
        if (!isValid) {
            isSubmitting = false;
            return;
        }
        
        // Show loading spinner and disable button
        submitButton.disabled = true;
        loadingSpinner.style.display = 'block';
        
        try {
            const response = await fetch('/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    firstName: firstName,
                    lastName: lastName,
                    email: email
                })
            });
            
            const data = await response.json();
            
            if (response.ok) {
                // Hide form and show success message
                form.classList.add('hidden');
                loadingSpinner.style.display = 'none';
                successMessage.classList.add('show');
            } else {
                document.getElementById('email-error').textContent = data.error || 'An error occurred. Please try again.';
                document.getElementById('email-error').style.display = 'block';
                submitButton.disabled = false;
                loadingSpinner.style.display = 'none';
            }
        } catch (error) {
            console.error('Error:', error);
            document.getElementById('email-error').textContent = 'An error occurred. Please try again.';
            document.getElementById('email-error').style.display = 'block';
            submitButton.disabled = false;
            loadingSpinner.style.display = 'none';
        } finally {
            isSubmitting = false;
        }
    });

    // Email validation helper
    function isValidEmail(email) {
        const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        return re.test(String(email).toLowerCase());
    }
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Add animation to prayer box on scroll
const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('fade-in');
        }
    });
}, {
    threshold: 0.1
});

document.querySelectorAll('.prayer-box').forEach(box => {
    observer.observe(box);
}); 