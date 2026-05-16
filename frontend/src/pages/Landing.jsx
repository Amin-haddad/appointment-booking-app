import { Link } from 'react-router-dom';

const features = [
  {
    title: 'Online Booking',
    description: 'Schedule appointments in minutes with real-time slot availability.',
  },
  {
    title: 'Email Reminders',
    description: 'Automatic reminders help patients stay on track and reduce no-shows.',
  },
  {
    title: 'Secure & Private',
    description: 'Patient details are handled with strong security and privacy controls.',
  },
  {
    title: '24/7 Access',
    description: 'Book and manage appointments anytime, from any device.',
  },
];

const testimonials = [
  {
    quote: 'Booking my follow-up took less than two minutes. Very smooth and professional.',
    author: 'Sarah M.',
  },
  {
    quote: 'The reminder emails are incredibly helpful. I never miss an appointment now.',
    author: 'David R.',
  },
  {
    quote: 'Clean interface, fast booking, and everything felt secure.',
    author: 'Priya K.',
  },
];

export default function Landing() {
  return (
    <div className="landing-page">
      <section className="landing-hero">
        <p className="landing-kicker">Trusted Healthcare Scheduling</p>
        <h1>MedBook</h1>
        <p className="landing-tagline">
          Easy, secure appointment booking for modern medical practices.
        </p>
        <div className="landing-cta-row">
          <Link to="/register" className="btn btn-primary" style={{ width: 'auto', padding: '14px 28px' }} id="landing-get-started">
            Get Started
          </Link>
          <a href="#features" className="btn btn-secondary" style={{ padding: '14px 28px' }} id="landing-learn-more">
            Learn More
          </a>
        </div>
      </section>

      <section className="landing-section" id="features">
        <h2>Why practices choose MedBook</h2>
        <div className="landing-grid">
          {features.map((feature) => (
            <article key={feature.title} className="landing-card">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <h2>Patient Testimonials</h2>
        <div className="landing-grid landing-grid-testimonials">
          {testimonials.map((item) => (
            <article key={item.author} className="landing-card testimonial-card">
              <p className="testimonial-quote">"{item.quote}"</p>
              <p className="testimonial-author">— {item.author}</p>
            </article>
          ))}
        </div>
      </section>

      <footer className="landing-footer">
        <p>MedBook • Professional Appointment Management for Clinics and Practices</p>
        <p>© {new Date().getFullYear()} MedBook. All rights reserved.</p>
      </footer>
    </div>
  );
}
