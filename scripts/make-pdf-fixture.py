"""Generate our synthetic PDF regression fixture; no external paper or personal data."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from PIL import Image, ImageDraw, ImageFont

out = Path('tests/fixtures/pdf-learning-sample.pdf')
out.parent.mkdir(parents=True, exist_ok=True)
temp = Path('tmp/pdfs'); temp.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(out), pagesize=A4, invariant=1)
c.setTitle('Learning notes - synthetic PDF fixture')
c.setAuthor('Studyboard contributors')
def heading(title, subtitle):
    c.setFillColorRGB(.13,.22,.18); c.setFont('Helvetica-Bold',21); c.drawString(44,790,title)
    c.setFont('Helvetica',10); c.setFillColorRGB(.4,.48,.43); c.drawString(44,768,subtitle)
    c.setStrokeColorRGB(.8,.85,.8); c.line(44,752,551,752)
def footer(number):
    c.setFont('Helvetica',9); c.setFillColorRGB(.5,.55,.5)
    c.drawString(44,35,'Synthetic test material - not a research publication'); c.drawRightString(551,35,str(number))

c.bookmarkPage('intro'); c.addOutlineEntry('1. Argument, formula, and figure','intro')
heading('Evidence, assumptions, and conclusions','A two-column reading and annotation fixture')
left=['LEFT COLUMN','A claim needs evidence and explicit assumptions.','Reading carefully separates observations','from the explanation offered by an author.','An alternative explanation may fit the same data.','Record the boundary of the claim before','turning it into a general conclusion.','','These lines belong to the left column only.']
right=['RIGHT COLUMN','Correlation alone does not establish causation.','A mechanism can explain how a result occurs.','It must still be checked against the evidence.','Discussion can reveal hidden assumptions.','A useful note connects a question to a source.','','These lines belong to the right column only.']
for x,lines in [(44,left),(315,right)]:
    y=724
    for i,line in enumerate(lines):
        c.setFont('Helvetica-Bold' if i==0 else 'Helvetica',10.5)
        c.setFillColorRGB(.13,.22,.18); c.drawString(x,y,line); y-=21
c.setFont('Times-Italic',20); c.drawString(55,470,'E[Y | X] = b0 + b1 X')
c.setFont('Helvetica',10); c.drawString(55,449,'Equation (1): an illustrative conditional-mean expression.')
c.setFont('Helvetica-Bold',13); c.drawString(55,407,'Figure 1. Observed values in four example groups')
for i,h in enumerate([70,120,90,155]):
    c.setFillColorRGB(.25+i*.09,.48,.38+i*.04); c.rect(85+i*108,200,58,h,fill=1,stroke=0)
    c.setFillColorRGB(.13,.22,.18); c.setFont('Helvetica',11); c.drawCentredString(114+i*108,180,chr(65+i)); c.drawCentredString(114+i*108,208+h,str(h))
c.setStrokeColorRGB(.45,.5,.45);c.line(55,200,535,200)
c.setFont('Helvetica',10);c.drawString(55,135,'The chart is synthetic and exists to test faithful visual extraction.')
footer(1);c.showPage()

pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
c.bookmarkPage('chinese');c.addOutlineEntry('2. Selectable Chinese text and table','chinese')
heading('Chinese text and a comparison table','Page two tests Unicode text selection and source navigation')
c.setFillColorRGB(.13,.22,.18);c.setFont('STSong-Light',12)
for i,line in enumerate(['这是可选择的中文原文，用来验证摘录、划线和原页定位。','知识点：先检查证据，再辨别作者的解释与自己的推断。','同一份 PDF 可以关联到多篇笔记，每篇笔记保留自己的批注。']):c.drawString(44,714-i*30,line)
rows=[['环节','要问的问题','保留的信息'],['主张','作者想说明什么？','核心判断'],['证据','依据来自哪里？','原文与图表'],['边界','在什么条件下成立？','假设与限制']]
for r,row in enumerate(rows):
    y=565-r*45
    for col,value in enumerate(row):
        x=44+col*169;c.setFillColorRGB(*((.93,.96,.92) if r==0 else (1,1,1)));c.rect(x,y,169,45,fill=1,stroke=1)
        c.setFillColorRGB(.13,.22,.18);c.drawString(x+10,y+17,value)
footer(2);c.showPage()

c.setPageRotation(90);c.bookmarkPage('rotated');c.addOutlineEntry('3. Rotated source coordinates','rotated')
c.setFont('Helvetica-Bold',18);c.drawString(50,480,'ROTATED PAGE: selection must remain anchored.')
c.setFont('Helvetica',13);c.drawString(50,450,'Zooming and rotation must preserve the original PDF location.')
c.rect(50,280,450,130);c.drawString(70,340,'A region selected here must return to this page.')
c.showPage();c.setPageRotation(0)

image=Image.new('RGB',(800,1000),'white');draw=ImageDraw.Draw(image);font=ImageFont.load_default(size=30)
for i,line in enumerate(['SCANNED PAGE - OCR ONLY','This page is an image, not a text layer.','Verify the recognized words before saving.','Question: which assumption is missing?']):draw.text((45,60+i*75),line,fill='#24382c',font=font)
draw.rectangle((55,410,740,710),outline='#426c58',width=4);draw.text((90,500),'A scanned figure can be quoted.',fill='#24382c',font=font)
image.save(temp/'scan-page.png')
c.bookmarkPage('scan');c.addOutlineEntry('4. Scanned page for optional OCR','scan')
c.drawImage(str(temp/'scan-page.png'),40,100,width=515,height=644)
footer(4);c.save()
from reportlab.lib.pdfencrypt import StandardEncryption
protected=canvas.Canvas(str(out.with_name('pdf-learning-protected.pdf')),pagesize=A4,encrypt=StandardEncryption('fixture-password',strength=128))
protected.setFont('Helvetica',18);protected.drawString(50,750,'Protected PDF fixture');protected.save()
print(out)
