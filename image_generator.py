"""
Image Generator for Divine Bridge
Generates high-quality JPEG images for daily verses and prayers
"""

import logging
from PIL import Image, ImageDraw, ImageFont, ImageColor, ImageFilter
from io import BytesIO
import textwrap
import os
import tempfile
# Removed selenium imports - using pure PIL approach

logger = logging.getLogger(__name__)


class ImageGenerator:
    """Generate shareable images for verses and prayers"""
    
    def __init__(self, logo_path='assets/logos/LogoOnly1.png'):
        """Initialize image generator with logo and background images"""
        self.logo_path = logo_path
        
        # Background image paths
        self.verse_background_path = 'static/assets/verse_background.jpg'
        self.prayer_background_path = 'static/assets/prayer_background.jpg'
        
        # Image dimensions (Instagram optimized)
        self.verse_width = 1080  # Square for verse (Instagram Feed)
        self.verse_height = 1080  # 1:1 ratio (Instagram Square)
        self.prayer_width = 1080  # Portrait for prayer
        self.prayer_height = 1350  # 4:5 ratio (Instagram Portrait)
        
        # Colors (matching your clean design) - converted to RGB tuples
        self.navy = (11, 31, 58)  # Deep navy #0B1F3A
        self.gold = (247, 201, 72)  # Golden yellow #F7C948
        self.blue = (26, 77, 220)  # Blue for website #1A4DDC
        self.bg_gradient = ("#f6f8fb", "#dbe7f4")  # Light gradient (for ImageColor.getrgb)
        
        # Legacy color mappings for compatibility
        self.text_color = self.navy
        self.accent_color = self.gold
        self.footer_color = self.navy
        self.footer_link_color = self.blue
        
        logger.info("ImageGenerator initialized with background images")
    
    def _load_background_image(self, background_path, width, height):
        """Load and resize background image"""
        try:
            if os.path.exists(background_path):
                bg_img = Image.open(background_path)
                # Resize to exact dimensions if needed
                if bg_img.size != (width, height):
                    bg_img = bg_img.resize((width, height), Image.Resampling.LANCZOS)
                return bg_img
            else:
                logger.warning(f"Background image not found: {background_path}, using gradient fallback")
                return self._create_gradient_background(width, height)
        except Exception as e:
            logger.warning(f"Error loading background image {background_path}: {e}, using gradient fallback")
            return self._create_gradient_background(width, height)
    
    def _create_gradient_background(self, width, height):
        """Create clean gradient background matching your design"""
        img = Image.new('RGB', (width, height), self.bg_gradient[0])
        draw = ImageDraw.Draw(img)
        
        # Simple vertical gradient like your clean code
        for y in range(height):
            ratio = y / height
            r1, g1, b1 = ImageColor.getrgb(self.bg_gradient[0])
            r2, g2, b2 = ImageColor.getrgb(self.bg_gradient[1])
            r = int(r1 + (r2 - r1) * ratio)
            g = int(g1 + (g2 - g1) * ratio)
            b = int(b1 + (b2 - b1) * ratio)
            draw.line([(0, y), (width, y)], fill=(r, g, b))
        
        return img
    
    def _create_sophisticated_gradient_background(self, width, height):
        """Create the exact gradient background from attached image"""
        img = Image.new('RGB', (width, height))
        
        # Exact colors from attached image
        top_color = (248, 250, 252)  # Light blue-grey
        bottom_color = (254, 254, 254)  # Warm off-white
        
        for y in range(height):
            ratio = y / height
            r = int(top_color[0] * (1 - ratio) + bottom_color[0] * ratio)
            g = int(top_color[1] * (1 - ratio) + bottom_color[1] * ratio)
            b = int(top_color[2] * (1 - ratio) + bottom_color[2] * ratio)
            
            for x in range(width):
                img.putpixel((x, y), (r, g, b))
        
        return img
    
    def _create_logo_header(self, img, draw, start_y):
        """Create the logo + DIVINE BRIDGE text header exactly like attached image"""
        try:
            # Load and resize logo
            logo = Image.open(self.logo_path)
            logo_height = 60  # Smaller, more elegant
            ratio = logo_height / logo.height
            new_width = int(logo.width * ratio)
            logo = logo.resize((new_width, logo_height), Image.Resampling.LANCZOS)
            
            # Position logo
            logo_x = (self.verse_width - new_width) // 2
            logo_y = start_y
            
            # Paste logo
            if logo.mode == 'RGBA':
                img.paste(logo, (logo_x, logo_y), logo)
            else:
                img.paste(logo, (logo_x, logo_y))
            
            # Add "DIVINE BRIDGE" text below logo (matching attached image)
            text_y = logo_y + logo_height + 20
            text_font = self._get_font(24, bold=True)
            text = "DIVINE BRIDGE"
            text_bbox = text_font.getbbox(text)
            text_width = text_bbox[2] - text_bbox[0]
            text_x = (self.verse_width - text_width) // 2
            draw.text((text_x, text_y), text, font=text_font, fill=self.text_color)
            
            return text_y + 40
            
        except Exception as e:
            logger.warning(f"Could not load logo: {e}")
            return start_y + 100
    
    def _add_title(self, draw, title, y):
        """Add the Daily Verse title with exact styling"""
        font = self._get_font(48, bold=True)  # Larger, more prominent
        bbox = font.getbbox(title)
        width = bbox[2] - bbox[0]
        x = (self.verse_width - width) // 2
        draw.text((x, y), title, font=font, fill=self.text_color)
    
    def _add_date(self, draw, date, y):
        """Add date with exact styling from attached image"""
        font = self._get_font(28)  # Smaller, sans-serif
        bbox = font.getbbox(date)
        width = bbox[2] - bbox[0]
        x = (self.verse_width - width) // 2
        draw.text((x, y), date, font=font, fill=self.text_color)
    
    def _add_decorative_line(self, draw, y):
        """Add the golden decorative line exactly like attached image"""
        line_width = 300  # Shorter, more elegant
        line_x = (self.verse_width - line_width) // 2
        draw.rectangle([line_x, y, line_x + line_width, y + 3], fill=self.accent_color)
    
    def _add_verse_text(self, draw, verse_text, y):
        """Add verse text with sophisticated typography"""
        font = self._get_font(36)  # Elegant serif size
        max_width = self.verse_width - 80  # More padding
        lines = self._wrap_text(verse_text, font, max_width)
        
        line_height = 50  # Elegant spacing
        for line in lines:
            bbox = font.getbbox(line)
            width = bbox[2] - bbox[0]
            x = (self.verse_width - width) // 2
            draw.text((x, y), line, font=font, fill=self.text_color)
            y += line_height
    
    def _calculate_verse_height(self, verse_text):
        """Calculate the height needed for verse text"""
        font = self._get_font(36)
        max_width = self.verse_width - 80
        lines = self._wrap_text(verse_text, font, max_width)
        return len(lines) * 50  # line_height
    
    def _add_reference(self, draw, reference, y):
        """Add reference with golden styling exactly like attached image"""
        font = self._get_font(32, bold=True)  # Elegant serif
        bbox = font.getbbox(reference)
        width = bbox[2] - bbox[0]
        x = (self.verse_width - width) // 2
        draw.text((x, y), reference, font=font, fill=self.accent_color)
    
    def _add_footer(self, draw, y):
        """Add footer exactly like attached image"""
        font = self._get_font(24)  # Smaller, sans-serif
        text = "Join our global community at divinebridge.io"
        bbox = font.getbbox(text)
        width = bbox[2] - bbox[0]
        x = (self.verse_width - width) // 2
        draw.text((x, y), text, font=font, fill=self.text_color)
    
    def _get_font(self, size, bold=False):
        """Get font with fallback to default"""
        try:
            # Try system fonts first (macOS)
            if bold:
                return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size)
            return ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", size)
        except:
            try:
                # Try Arial on Windows/Linux
                if bold:
                    return ImageFont.truetype("arial.ttf", size)
                return ImageFont.truetype("arial.ttf", size)
            except:
                try:
                    # Try other common fonts
                    if bold:
                        return ImageFont.truetype("/System/Library/Fonts/Arial.ttf", size)
                    return ImageFont.truetype("/System/Library/Fonts/Arial.ttf", size)
                except:
                    # Ultimate fallback
                    logger.warning(f"Could not load custom font, using default for size {size}")
                    return ImageFont.load_default()
    
    def _get_sans_font(self):
        """Get sans-serif font function for Faith Serif Blend (Inter/Lato/Open Sans equivalent)"""
        def get_font(size, bold=False):
            # Try modern sans-serif fonts (with bold variants)
            if bold:
                font_paths = [
                    "/System/Library/Fonts/Helvetica.ttc",  # macOS (supports bold via index)
                    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",  # macOS Bold
                    "/System/Library/Fonts/Supplemental/Arial.ttf",  # macOS
                    "arialbd.ttf",                          # Windows Bold
                    "arial.ttf",                            # Windows/Linux
                    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",  # Linux Bold
                ]
            else:
                font_paths = [
                    "/System/Library/Fonts/Helvetica.ttc",  # macOS
                    "/System/Library/Fonts/Arial.ttf",      # macOS
                    "arial.ttf",                            # Windows/Linux
                    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",  # Linux
                ]
            
            for font_path in font_paths:
                try:
                    # For TTC fonts, try to get bold variant
                    if bold and font_path.endswith('.ttc'):
                        try:
                            return ImageFont.truetype(font_path, size, index=1)  # Bold is usually index 1
                        except:
                            return ImageFont.truetype(font_path, size)
                    else:
                        return ImageFont.truetype(font_path, size)
                except:
                    continue
            
            # Fallback to default
            logger.warning(f"Using default font for sans-serif size {size}, bold={bold}")
            return ImageFont.load_default()
        
        return get_font
    
    def _get_serif_font(self):
        """Get serif font function for Faith Serif Blend (Playfair Display/Georgia/Merriweather equivalent)"""
        def get_font(size, bold=False):
            # Try serif fonts
            font_paths = [
                "/System/Library/Fonts/Times.ttc",      # macOS Times
                "/System/Library/Fonts/Georgia.ttf",    # macOS Georgia
                "times.ttf",                            # Windows Times
                "georgia.ttf",                          # Windows Georgia
                "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",  # Linux
            ]
            
            for font_path in font_paths:
                try:
                    return ImageFont.truetype(font_path, size)
                except:
                    continue
            
            # Fallback to default
            logger.warning(f"Using default font for serif size {size}")
            return ImageFont.load_default()
        
        return get_font
    
    def _wrap_text(self, text, font, max_width):
        """Wrap text to fit within max_width"""
        words = text.split()
        lines = []
        current_line = []
        
        for word in words:
            test_line = ' '.join(current_line + [word])
            bbox = font.getbbox(test_line)
            width = bbox[2] - bbox[0]
            
            if width <= max_width:
                current_line.append(word)
            else:
                if current_line:
                    lines.append(' '.join(current_line))
                current_line = [word]
        
        if current_line:
            lines.append(' '.join(current_line))
        
        return lines
    
    def generate_verse_image(self, verse_text, reference, date=None):
        """
        Generate daily verse image using clean PIL approach (Square - 1080x1080)
        
        Args:
            verse_text: The verse content
            reference: Bible reference (e.g., "John 3:16")
            date: Optional date string for display
        
        Returns:
            BytesIO object containing JPEG image
        """
        try:
            # Use clean PIL approach
            img = self._create_clean_verse_image(verse_text, reference, date)
            
            # Convert to JPEG
            output = BytesIO()
            img.save(output, format='JPEG', quality=95, optimize=True)
            output.seek(0)
            
            logger.info(f"Generated clean verse image for: {reference}")
            return output
            
        except Exception as e:
            logger.error(f"Error generating verse image: {e}")
            raise
    
    def _create_clean_verse_image(self, verse_text, reference, date):
        """Create verse image using provided background image with high quality rendering"""
        # Render at 2x resolution for crisp text, then downsample
        scale = 2
        render_width = self.verse_width * scale
        render_height = self.verse_height * scale
        
        # Load the provided background image at higher resolution
        img = self._load_background_image(self.verse_background_path, render_width, render_height)
        
        # Ensure RGB mode for best quality
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        draw = ImageDraw.Draw(img)
        
        # Get fonts - serif for title, sans-serif for rest
        font_sans = self._get_sans_font()
        font_serif = self._get_serif_font()
        
        # Dynamic font sizing based on verse length (scaled by 2x for high-res rendering)
        # Increased by ~25% for better readability
        verse_length = len(verse_text)
        if verse_length < 100:
            base_font_size = 45 * scale  # Increased from 36
        elif verse_length < 200:
            base_font_size = 40 * scale  # Increased from 32
        elif verse_length < 300:
            base_font_size = 35 * scale  # Increased from 28
        else:
            base_font_size = 30 * scale  # Increased from 24
        
        # Font sizes with dynamic verse sizing (scaled by 2x for high-res rendering)
        font_title = font_serif(28 * scale, bold=True)  # Daily Verse
        font_date = font_sans(14 * scale)  # Date
        font_verse = font_sans(base_font_size)  # Bible verse - dynamic size
        font_ref = font_sans(28 * scale, bold=True)  # Reference - golden yellow
        font_footer = font_sans(20 * scale)  # Footer - reduced from 26px to 20px for compact CTA
        
        # Colors matching the reference design exactly
        dark_blue = "#212B36"  # Primary text color
        golden_yellow = "#E0A840"  # Verse reference and line color
        logo_blue = "#2A80D0"  # Logo icon color
        website_blue = "#0f56ff"  # Website URL color (custom bright blue)
        
        current_y = 110 * scale  # Top margin: 100-120px (using 110px)
        
        # 1. Logo at the top (properly sized for square format, scaled for high-res)
        try:
            # Logo only (PNG with transparency)
            logo = Image.open(self.logo_path)
            # Calculate size to maintain aspect ratio - square logo (scaled)
            logo_size = 100 * scale  # Good size for square format
            logo = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
            logo_x = (render_width - logo_size) // 2
            if logo.mode == 'RGBA':
                img.paste(logo, (logo_x, current_y), logo)
            else:
                img.paste(logo, (logo_x, current_y))
            current_y += logo_size + (90 * scale)  # Logo → Title: 90px
        except Exception as e:
            logger.warning(f"Could not load logo: {e}")
            current_y += 190 * scale  # Fallback spacing
        
        # 2. Title "Daily Verse" - elegant serif (smaller)
        draw.text((render_width/2, current_y), "Daily Verse", font=font_title,
                 fill=dark_blue, anchor="mm")
        current_y += 40 * scale  # Title → Date: reduced spacing for smaller text
        
        # 3. Date
        if date:
            draw.text((render_width/2, current_y), date, font=font_date,
                     fill=dark_blue, anchor="mm")
            current_y += 40 * scale  # Date → Divider: reduced spacing
        else:
            current_y += 30 * scale
        
        # 4. Horizontal line - golden yellow (scaled)
        line_y = current_y + (15 * scale)  # Position line
        draw.line([(render_width/2 - (80 * scale), line_y), (render_width/2 + (80 * scale), line_y)],
                 fill=golden_yellow, width=3 * scale)
        current_y += 80 * scale  # Divider → Verse Text: reduced spacing to center verse better
        
        # 5. Bible verse - main content with increased margins (no quotation marks)
        max_width = (self.verse_width - 160) * scale  # Increased margins (80px each side), scaled
        
        # Use verse text without quotation marks
        verse_lines = self._wrap_text(verse_text, font_verse, max_width)
        
        # Doubled line spacing for maximum readability (scaled)
        if verse_length < 100:
            line_spacing = 70 * scale  # Doubled from 35px
        elif verse_length < 200:
            line_spacing = 64 * scale  # Doubled from 32px
        elif verse_length < 300:
            line_spacing = 56 * scale  # Doubled from 28px
        else:
            line_spacing = 50 * scale  # Doubled from 25px
        
        verse_start_y = current_y
        
        # Draw verse lines (clean, no quotation marks)
        for line in verse_lines:
            draw.text((render_width/2, current_y), line, font=font_verse,
                     fill=dark_blue, anchor="mm")
            current_y += line_spacing
        
        verse_end_y = current_y
        current_y += 80 * scale  # Verse Text → Reference: reduced spacing for better centering
        
        # 6. Verse reference - golden yellow
        draw.text((render_width/2, current_y), reference, font=font_ref,
                 fill=golden_yellow, anchor="mm")
        current_y += 100 * scale  # Reference → CTA: reduced spacing
        
        # 7. Call to action footer with recommended spacing
        # Three-line inspiring message (manually formatted, center-justified)
        cta_lines = [
            "Join thousands of",
            "believers in a unified mission",
            "of faith, hope, and spiritual growth."
        ]
        
        # Draw each line of the CTA (center-justified)
        for cta_line in cta_lines:
            draw.text((render_width/2, current_y), cta_line, 
                     font=font_footer, fill=dark_blue, anchor="mm")
            current_y += 32 * scale  # Line spacing for CTA
        
        current_y += 10 * scale  # Extra space between CTA and website URL
        
        # Make website text bold with custom bright blue color (scaled)
        font_website_bold = font_sans(26 * scale, bold=True)
        draw.text((render_width/2, current_y), "divinebridge.io", 
                 font=font_website_bold, fill=website_blue, anchor="mm")
        
        # Downsample to final size for crisp, anti-aliased appearance
        img = img.resize((self.verse_width, self.verse_height), Image.Resampling.LANCZOS)
        
        # Optional: Apply slight sharpening for extra crispness
        img = img.filter(ImageFilter.SHARPEN)
        
        return img
    
    def _create_verse_html_template(self, verse_text, reference, date):
        """Create HTML template matching attached design exactly"""
        # Get logo as base64 data URL
        logo_data_url = self._get_logo_as_data_url()
        
        # Get background image as base64 data URL
        background_data_url = self._get_background_as_data_url(self.verse_background_path)
        
        html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600&display=swap');
                
                body {{
                    margin: 0;
                    padding: 0;
                    width: 1080px;
                    height: 1350px;
                    background-image: url('{background_data_url}');
                    background-size: cover;
                    background-position: center;
                    background-repeat: no-repeat;
                    font-family: 'Inter', sans-serif;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: flex-start;
                    padding-top: 80px;
                }}
                
                .logo-container {{
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    margin-bottom: 40px;
                }}
                
                .logo {{
                    width: 60px;
                    height: 60px;
                    margin-bottom: 20px;
                }}
                
                .brand-text {{
                    font-family: 'Inter', sans-serif;
                    font-size: 24px;
                    font-weight: 600;
                    color: #1a2b4d;
                    letter-spacing: 2px;
                }}
                
                .title {{
                    font-family: 'Playfair Display', serif;
                    font-size: 56px;
                    font-weight: 700;
                    color: #1a2b4d;
                    margin: 40px 0;
                    text-align: center;
                }}
                
                .date {{
                    font-family: 'Inter', sans-serif;
                    font-size: 28px;
                    font-weight: 400;
                    color: #1a2b4d;
                    margin-bottom: 30px;
                    text-align: center;
                }}
                
                .decorative-line {{
                    width: 300px;
                    height: 3px;
                    background-color: #e0a800;
                    margin: 30px 0 60px 0;
                }}
                
                .verse {{
                    font-family: 'Playfair Display', serif;
                    font-size: 36px;
                    font-weight: 400;
                    color: #1a2b4d;
                    line-height: 1.6;
                    text-align: center;
                    max-width: 900px;
                    margin: 0 auto 60px auto;
                    padding: 0 40px;
                }}
                
                .reference {{
                    font-family: 'Playfair Display', serif;
                    font-size: 32px;
                    font-weight: 600;
                    color: #e0a800;
                    text-align: center;
                    margin-bottom: 80px;
                }}
                
                .footer {{
                    font-family: 'Inter', sans-serif;
                    font-size: 24px;
                    font-weight: 400;
                    color: #1a2b4d;
                    text-align: center;
                    margin-top: auto;
                    margin-bottom: 60px;
                }}
            </style>
        </head>
        <body>
            <div class="logo-container">
                <img src="{logo_data_url}" alt="Divine Bridge" class="logo">
                <div class="brand-text">DIVINE BRIDGE</div>
            </div>
            
            <div class="title">Daily Verse</div>
            {f'<div class="date">{date}</div>' if date else ''}
            <div class="decorative-line"></div>
            
            <div class="verse">{verse_text}</div>
            <div class="reference">{reference}</div>
            
            <div class="footer">Join our global community at divinebridge.io</div>
        </body>
        </html>
        """
        return html
    
    def _get_logo_as_data_url(self):
        """Convert logo to base64 data URL for HTML embedding"""
        try:
            import base64
            with open(self.logo_path, 'rb') as f:
                logo_data = f.read()
                logo_base64 = base64.b64encode(logo_data).decode('utf-8')
                return f"data:image/png;base64,{logo_base64}"
        except Exception as e:
            logger.warning(f"Could not load logo for HTML: {e}")
            # Return a placeholder or empty data URL
            return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
    
    def _get_background_as_data_url(self, background_path):
        """Convert background image to base64 data URL for HTML embedding"""
        try:
            import base64
            if os.path.exists(background_path):
                with open(background_path, 'rb') as f:
                    bg_data = f.read()
                    bg_base64 = base64.b64encode(bg_data).decode('utf-8')
                    # Determine file extension for proper MIME type
                    ext = background_path.lower().split('.')[-1]
                    mime_type = f"image/{ext}" if ext in ['jpg', 'jpeg', 'png', 'gif'] else "image/jpeg"
                    return f"data:{mime_type};base64,{bg_base64}"
            else:
                logger.warning(f"Background image not found: {background_path}")
                # Return gradient fallback as data URL
                return self._create_gradient_data_url()
        except Exception as e:
            logger.warning(f"Could not load background image for HTML: {e}")
            # Return gradient fallback as data URL
            return self._create_gradient_data_url()
    
    def _create_gradient_data_url(self):
        """Create gradient background as base64 data URL"""
        try:
            import base64
            # Create a simple gradient image
            img = self._create_gradient_background(1080, 1350)
            output = BytesIO()
            img.save(output, format='JPEG', quality=95)
            output.seek(0)
            bg_base64 = base64.b64encode(output.getvalue()).decode('utf-8')
            return f"data:image/jpeg;base64,{bg_base64}"
        except Exception as e:
            logger.error(f"Could not create gradient data URL: {e}")
            # Ultimate fallback - solid color
            return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwA/8A8A"
    
    def _render_html_to_image(self, html_content, width, height):
        """Render HTML to high-quality image using Chrome browser"""
        try:
            # Set up Chrome options for headless rendering
            chrome_options = Options()
            chrome_options.add_argument("--headless")
            chrome_options.add_argument("--no-sandbox")
            chrome_options.add_argument("--disable-dev-shm-usage")
            chrome_options.add_argument(f"--window-size={width},{height}")
            chrome_options.add_argument("--force-device-scale-factor=1")
            
            # Initialize Chrome driver
            service = Service(ChromeDriverManager().install())
            driver = webdriver.Chrome(service=service, options=chrome_options)
            
            # Create temporary HTML file
            with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False) as f:
                f.write(html_content)
                html_file = f.name
            
            # Load HTML file
            file_url = f"file://{html_file}"
            driver.get(file_url)
            
            # Wait for fonts to load
            driver.implicitly_wait(3)
            
            # Take screenshot
            screenshot = driver.get_screenshot_as_png()
            
            # Clean up
            driver.quit()
            os.unlink(html_file)
            
            # Convert to PIL Image
            img = Image.open(BytesIO(screenshot))
            return img
            
        except Exception as e:
            logger.error(f"Error rendering HTML to image: {e}")
            # Fallback to PIL
            return None
    
    def _create_precise_verse_image(self, verse_text, reference, date):
        """Create precise verse image with exact measurements from attached design"""
        img = self._load_background_image(self.verse_background_path, self.verse_width, self.verse_height)
        draw = ImageDraw.Draw(img)
        
        # Exact measurements from attached image analysis
        current_y = 80  # Start position
        
        # Logo + DIVINE BRIDGE (exact positioning)
        current_y = self._add_precise_logo_header(img, draw, current_y)
        
        # Daily Verse title (exact styling)
        current_y = self._add_precise_title(draw, "Daily Verse", current_y)
        
        # Date (if provided)
        if date:
            current_y = self._add_precise_date(draw, date, current_y)
        
        # Decorative line (exact dimensions)
        current_y = self._add_precise_decorative_line(draw, current_y)
        
        # Verse text (exact typography)
        current_y = self._add_precise_verse_text(draw, verse_text, current_y)
        
        # Reference (exact styling)
        current_y = self._add_precise_reference(draw, reference, current_y)
        
        # Footer (exact positioning)
        self._add_precise_footer(draw, current_y)
        
        return img
    
    def _add_precise_logo_header(self, img, draw, start_y):
        """Add logo + DIVINE BRIDGE with exact positioning from attached image"""
        try:
            # Logo: 60x60px, centered
            logo = Image.open(self.logo_path)
            logo = logo.resize((60, 60), Image.Resampling.LANCZOS)
            
            logo_x = (self.verse_width - 60) // 2
            logo_y = start_y
            
            if logo.mode == 'RGBA':
                img.paste(logo, (logo_x, logo_y), logo)
            else:
                img.paste(logo, (logo_x, logo_y))
            
            # DIVINE BRIDGE text: 24px, Inter font, 2px letter-spacing
            text_y = logo_y + 60 + 20  # 20px gap
            text_font = self._get_font(24, bold=True)
            text = "DIVINE BRIDGE"
            bbox = text_font.getbbox(text)
            width = bbox[2] - bbox[0]
            x = (self.verse_width - width) // 2
            draw.text((x, text_y), text, font=text_font, fill=self.text_color)
            
            return text_y + 40  # 40px spacing to next element
            
        except Exception as e:
            logger.warning(f"Could not load logo: {e}")
            return start_y + 100
    
    def _add_precise_title(self, draw, title, y):
        """Add Daily Verse title with exact styling from attached image"""
        # 56px, Playfair Display serif, bold
        font = self._get_font(56, bold=True)
        bbox = font.getbbox(title)
        width = bbox[2] - bbox[0]
        x = (self.verse_width - width) // 2
        draw.text((x, y), title, font=font, fill=self.text_color)
        return y + 100  # 100px spacing to date
    
    def _add_precise_date(self, draw, date, y):
        """Add date with exact styling from attached image"""
        # 28px, Inter sans-serif, regular weight
        font = self._get_font(28)
        bbox = font.getbbox(date)
        width = bbox[2] - bbox[0]
        x = (self.verse_width - width) // 2
        draw.text((x, y), date, font=font, fill=self.text_color)
        return y + 80  # 80px spacing to decorative line
    
    def _add_precise_decorative_line(self, draw, y):
        """Add golden decorative line with exact dimensions"""
        # 300px wide, 3px tall, golden color
        line_width = 300
        line_x = (self.verse_width - line_width) // 2
        draw.rectangle([line_x, y, line_x + line_width, y + 3], fill=self.accent_color)
        return y + 60  # 60px spacing to verse text
    
    def _add_precise_verse_text(self, draw, verse_text, y):
        """Add verse text with exact typography from attached image"""
        # 36px, Playfair Display serif, 1.6 line height
        font = self._get_font(36)
        max_width = self.verse_width - 80  # 40px padding each side
        lines = self._wrap_text(verse_text, font, max_width)
        
        line_height = 58  # 36px * 1.6 line height
        for line in lines:
            bbox = font.getbbox(line)
            width = bbox[2] - bbox[0]
            x = (self.verse_width - width) // 2
            draw.text((x, y), line, font=font, fill=self.text_color)
            y += line_height
        
        return y + 60  # 60px spacing to reference
    
    def _add_precise_reference(self, draw, reference, y):
        """Add reference with exact golden styling"""
        # 32px, Playfair Display serif, bold, golden color
        font = self._get_font(32, bold=True)
        bbox = font.getbbox(reference)
        width = bbox[2] - bbox[0]
        x = (self.verse_width - width) // 2
        draw.text((x, y), reference, font=font, fill=self.accent_color)
        return y + 80  # 80px spacing to footer
    
    def _add_precise_footer(self, draw, y):
        """Add footer with exact positioning at bottom"""
        # 24px, Inter sans-serif, positioned near bottom
        footer_y = self.verse_height - 100
        font = self._get_font(24)
        text = "Join our global community at divinebridge.io"
        bbox = font.getbbox(text)
        width = bbox[2] - bbox[0]
        x = (self.verse_width - width) // 2
        draw.text((x, footer_y), text, font=font, fill=self.text_color)
    
    def generate_prayer_image(self, prayer_text, date=None):
        """
        Generate image for daily prayer (Portrait - 1080x1350)
        
        Args:
            prayer_text: The prayer content
            date: Optional date string for display
        
        Returns:
            BytesIO object containing JPEG image
        """
        try:
            # Use clean PIL approach for prayer
            img = self._create_clean_prayer_image(prayer_text, date)
            
            # Convert to JPEG
            output = BytesIO()
            img.save(output, format='JPEG', quality=95, optimize=True)
            output.seek(0)
            
            logger.info(f"Generated clean prayer image")
            return output
            
        except Exception as e:
            logger.error(f"Error generating prayer image: {e}")
            raise
    
    def _create_clean_prayer_image(self, prayer_text, date):
        """Create prayer image using high-quality rendering (Portrait format 1080x1350)"""
        # Render at 2x resolution for crisp text, then downsample
        scale = 2
        render_width = self.prayer_width * scale
        render_height = self.prayer_height * scale
        
        # Load the provided background image at higher resolution
        img = self._load_background_image(self.prayer_background_path, render_width, render_height)
        
        # Ensure RGB mode for best quality
        if img.mode != 'RGB':
            img = img.convert('RGB')
        
        draw = ImageDraw.Draw(img)
        
        # Get fonts - serif for title, sans-serif for rest
        font_sans = self._get_sans_font()
        font_serif = self._get_serif_font()
        
        # Font sizes (scaled by 2x for high-res rendering)
        font_title = font_serif(28 * scale, bold=True)  # Prayer title
        font_date = font_sans(14 * scale)  # Date
        font_prayer = font_sans(20 * scale)  # Prayer text - reduced from 28px to 20px to fit more
        font_footer = font_sans(20 * scale)  # Footer - compact CTA
        
        # Colors matching the verse design
        dark_blue = "#212B36"  # Primary text color
        golden_yellow = "#E0A840"  # Line color
        website_blue = "#0f56ff"  # Website URL color
        
        current_y = 80 * scale  # Top margin - moved up from 110px
        
        # 1. Logo at the top (scaled for high-res, reduced size)
        try:
            logo = Image.open(self.logo_path)
            logo_size = 70 * scale  # Reduced from 100px to 70px
            logo = logo.resize((logo_size, logo_size), Image.Resampling.LANCZOS)
            logo_x = (render_width - logo_size) // 2
            if logo.mode == 'RGBA':
                img.paste(logo, (logo_x, current_y), logo)
            else:
                img.paste(logo, (logo_x, current_y))
            current_y += logo_size + (70 * scale)  # Logo → Title: reduced from 90px to 70px
        except Exception as e:
            logger.warning(f"Could not load logo: {e}")
            current_y += 140 * scale  # Fallback spacing (reduced)
        
        # 2. Title "Today's Global Prayer"
        draw.text((render_width/2, current_y), "Today's Global Prayer", font=font_title,
                 fill=dark_blue, anchor="mm")
        current_y += 40 * scale  # Title → Date
        
        # 3. Date
        if date:
            draw.text((render_width/2, current_y), date, font=font_date,
                     fill=dark_blue, anchor="mm")
            current_y += 40 * scale  # Date → Divider
        else:
            current_y += 30 * scale
        
        # 4. Horizontal line - golden yellow
        line_y = current_y + (15 * scale)
        draw.line([(render_width/2 - (80 * scale), line_y), (render_width/2 + (80 * scale), line_y)],
                 fill=golden_yellow, width=3 * scale)
        current_y += 80 * scale  # Divider → Prayer Text
        
        # 5. Prayer text - with increased margins
        max_width = (self.prayer_width - 160) * scale  # Increased margins (80px each side)
        
        # Split into paragraphs and wrap text
        paragraphs = prayer_text.split('\n\n')
        line_spacing = 35 * scale  # Reduced spacing for 20px text (was 45px for 28px text)
        paragraph_spacing = 25 * scale  # Reduced paragraph spacing (was 30px)
        
        for para in paragraphs:
            if para.strip():
                # Wrap paragraph text
                para_lines = self._wrap_text(para.strip(), font_prayer, max_width)
                
                for line in para_lines:
                    if current_y < render_height - (250 * scale):  # Leave space for footer
                        draw.text((render_width/2, current_y), line, font=font_prayer,
                                 fill=dark_blue, anchor="mm")
                        current_y += line_spacing
                
                current_y += paragraph_spacing  # Extra space after paragraph
        
        # 6. Call to action footer (three lines, center-justified)
        # Position CTA near bottom with proper spacing
        footer_start_y = render_height - (180 * scale)  # Reserve space for CTA + website
        current_y = footer_start_y
        
        cta_lines = [
            "Join thousands of",
            "believers in a unified mission",
            "of faith, hope, and spiritual growth."
        ]
        
        # Draw each line of the CTA
        for cta_line in cta_lines:
            draw.text((render_width/2, current_y), cta_line, 
                     font=font_footer, fill=dark_blue, anchor="mm")
            current_y += 32 * scale  # Line spacing for CTA
        
        current_y += 10 * scale  # Space between CTA and website URL
        
        # 7. Website URL (bold, bright blue)
        font_website_bold = font_sans(26 * scale, bold=True)
        draw.text((render_width/2, current_y), "divinebridge.io", 
                 font=font_website_bold, fill=website_blue, anchor="mm")
        
        # Downsample to final size for crisp, anti-aliased appearance
        img = img.resize((self.prayer_width, self.prayer_height), Image.Resampling.LANCZOS)
        
        # Apply slight sharpening for extra crispness
        img = img.filter(ImageFilter.SHARPEN)
        
        return img


# Singleton instance
_image_generator = None

def get_image_generator():
    """Get singleton instance of ImageGenerator"""
    global _image_generator
    if _image_generator is None:
        _image_generator = ImageGenerator()
    return _image_generator

