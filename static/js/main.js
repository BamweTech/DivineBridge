// Form handling
document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('subscribe-form');
    const submitButton = form.querySelector('button[type="submit"]');
    const messageDiv = document.getElementById('message');

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Disable submit button and show loading state
        submitButton.disabled = true;
        submitButton.textContent = 'Subscribing...';
        
        // Get form data
        const formData = {
            email: form.querySelector('#email').value,
            firstName: form.querySelector('#firstName').value,
            lastName: form.querySelector('#lastName').value
        };

        try {
            const response = await fetch('/subscribe', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(formData)
            });

            const data = await response.json();

            if (data.success) {
                // Show success message
                messageDiv.textContent = 'Thank you for subscribing! Please check your email.';
                messageDiv.className = 'alert alert-success';
                
                // Reset form
                form.reset();
            } else {
                // Show error message
                messageDiv.textContent = data.message || 'An error occurred. Please try again.';
                messageDiv.className = 'alert alert-error';
            }
        } catch (error) {
            // Show error message
            messageDiv.textContent = 'An error occurred. Please try again.';
            messageDiv.className = 'alert alert-error';
        } finally {
            // Re-enable submit button and restore text
            submitButton.disabled = false;
            submitButton.textContent = 'Subscribe';
        }
    });
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